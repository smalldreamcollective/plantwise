import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, AIMessage, BaseMessage, SystemMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import dotenv from 'dotenv';
import { allTools } from './tools';

dotenv.config();

const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  command: Annotation<string>({ reducer: (_, y) => y, default: () => '' }),
  photo_path: Annotation<string | null>({ reducer: (_, y) => y, default: () => null }),
  plant_id: Annotation<number | null>({ reducer: (_, y) => y, default: () => null }),
  result: Annotation<string>({ reducer: (_, y) => y, default: () => '' }),
});

type GraphStateType = typeof GraphState.State;

function createModel() {
  return new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  }).bindTools(allTools);
}

function shouldContinue(state: GraphStateType): 'tools' | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }
  return END;
}

async function agentNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const model = createModel();
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

function buildSystemPrompt(
  command: string,
  photoPath: string | null,
  plantId: number | null
): string {
  const parts = [
    'You are PlantWise, an expert houseplant care assistant.',
    `The user is running the "${command}" command.`,
  ];

  if (photoPath) parts.push(`Photo path: ${photoPath}`);
  if (plantId) parts.push(`Plant ID: ${plantId}`);

  parts.push(
    '',
    'Use your available tools to fulfill the user request.',
    'Always present results in a friendly, helpful tone.',
    'For identification: summarize the top plant matches with probabilities.',
    'For diagnosis: clearly explain health issues and actionable care advice.',
    "For status: summarize the plant's care history and current health."
  );

  if (command === 'identify') {
    parts.push(
      '',
      'After identifying the plant, append a JSON block at the very end of your response with care recommendations for the top match.',
      'Use this exact format (no extra text after the block):',
      '```json',
      '{"name":"<common name>","species":"<scientific name>","watering_interval_days":<number>,"moisture_threshold_pct":<number>,"moisture_upper_threshold_pct":<number>,"notes":"<brief care note>"}',
      '```'
    );
  }

  return parts.join('\n');
}

export function buildInitialMessages(
  command: string,
  photoPath: string | null,
  plantId: number | null,
  userMessage: string
): BaseMessage[] {
  const system = buildSystemPrompt(command, photoPath, plantId);
  return [new SystemMessage(system), new HumanMessage(userMessage)];
}

export async function runAgent(
  command: string,
  photoPath: string | null,
  plantId: number | null,
  userMessage: string
): Promise<string> {
  const toolNode = new ToolNode(allTools);

  const graph = new StateGraph(GraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue)
    .addEdge('tools', 'agent')
    .compile();

  const initialMessages = buildInitialMessages(command, photoPath, plantId, userMessage);

  const finalState = await graph.invoke({
    messages: initialMessages,
    command,
    photo_path: photoPath,
    plant_id: plantId,
    result: '',
  });

  const lastMessage = finalState.messages[finalState.messages.length - 1];
  return typeof lastMessage.content === 'string'
    ? lastMessage.content
    : JSON.stringify(lastMessage.content);
}
