import { ChatMistralAI } from "@langchain/mistralai";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import logger from "../utils/logger.js";

// Initialize Mistral LLM — singleton
const llm = new ChatMistralAI({
    model: "mistral-small-latest",  // faster + free tier friendly
    temperature: 0.3,
    apiKey: process.env.MISTRAL_API_KEY,
    timeout: 60000,  // 60 second timeout
    maxRetries: 2,
});

/**
 * buildPrompt — creates chat prompt with system message + history + input.
 * Language-aware — responds in Hindi if transcript is Hindi.
 */
const buildPrompt = (language) => ChatPromptTemplate.fromMessages([
    ["system", `You are an intelligent AI knowledge agent.
${language === "hi"
        ? "The meeting was in Hindi. Respond in Hindi."
        : language === "mixed"
        ? "The meeting had mixed Hindi and English. Match the language the user uses."
        : "Respond in English."
    }

You have access to the most relevant sections of the transcript below.
Base all your answers strictly on the provided content.
If something is not mentioned in the content, say so clearly.

For conversational questions (what was discussed, who said what, etc):
- Respond in plain natural language only
- No JSON, no code blocks

Only use JSON format when user explicitly asks to extract/list action items or decisions:
{{
  "type": "structured",
  "summary": "...",
  "actionItems": [{{"task": "...", "assignedTo": "...", "dueDate": "..."}}],
  "keyDecisions": ["..."]
}}

RELEVANT CONTENT SECTIONS:
{context}`],
    new MessagesPlaceholder("history"),
    ["human", "{input}"],
]);

/**
 * chat — main LLM call with conversation memory.
 * 
 * history: last 10 turns from MongoDB (not LangChain memory object)
 * contextChunks: top K similar chunks from similarity search
 * Returns: { response, isStructured, parsed }
 */
export const chat = async ({
    message,
    contextChunks,
    conversationHistory,
    language = "en",
}) => {
    // Build context string from relevant chunks
    const context = contextChunks.length > 0
        ? contextChunks
            .map(c => `[${c.speaker} @ ${Math.round(c.start)}s]: ${c.text}`)
            .join("\n\n")
        : "No specific context found — answering from full transcript summary.";

    // Rebuild history as LangChain message objects
    // We do NOT use ConversationBufferWindowMemory — we manage history in MongoDB
    const history = conversationHistory.map(turn =>
        turn.role === "human"
            ? new HumanMessage(turn.content)
            : new AIMessage(turn.content)
    );

    const prompt = buildPrompt(language);
    const chain = prompt.pipe(llm);

    logger.info({
        contextChunks: contextChunks.length,
        historyTurns: history.length,
        language,
    }, "Calling Mistral");

    const response = await chain.invoke({
        input: message,
        context,
        history,
    });

    const responseText = response.content;

    // Try to parse as structured JSON
    let isStructured = false;
    let parsed = null;

    try {
        // Extract JSON from response if present
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
            isStructured = parsed.type === "structured";
        }
    } catch {
        // Not JSON — plain conversational response
    }

    return { response: responseText, isStructured, parsed };
};

/**
 * generateSummary — dedicated summary call (not conversational).
 * Used for initial meeting summary generation.
 */
export const generateSummary = async (fullText, language = "en") => {
    const languageInstruction = language === "hi"
        ? "The transcript is in Hindi. Respond in Hindi."
        : "Respond in English.";

    const prompt = ChatPromptTemplate.fromMessages([
        ["system", `You are an AI content summarizer. ${languageInstruction}
        
Analyze the transcript and respond ONLY with this JSON:
{{
  "type": "structured",
  "summary": "3-5 sentence overview of the content",
  "actionItems": [
    {{"task": "task description", "assignedTo": "person name or null", "dueDate": "date or null"}}
  ],
  "keyDecisions": ["decision 1", "decision 2"],
  "topics": ["topic 1", "topic 2"],
  "sentiment": "positive|neutral|negative"
}}`],
        ["human", "TRANSCRIPT:\n{transcript}"],
    ]);

    const chain = prompt.pipe(llm);
    const response = await chain.invoke({ transcript: fullText.slice(0, 15000) });

    try {
        const jsonMatch = response.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {
        logger.error({ response: response.content }, "Failed to parse summary JSON");
    }

    return null;
};