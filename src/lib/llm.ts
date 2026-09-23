import type { LanguageModel } from "ai";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LLMAssistant } from "../modules/repository-analyzer/entities.js";
import type { AppConfig } from "../config/index.js";

export function createLLMModel(config: AppConfig): LanguageModel | null {
  if (!config.llm) return null;
  const { provider, model, apiKey } = config.llm;
  if (provider === "openai") {
    return createOpenAI({ apiKey })(model);
  }
  if (provider === "anthropic") {
    return createAnthropic({ apiKey })(model);
  }
  // google
  return createGoogleGenerativeAI({ apiKey })(model);
}

export function createLLMAssistant(config: AppConfig): LLMAssistant | null {
  const llmModel = createLLMModel(config);
  if (!llmModel) return null;
  return {
    async inferModuleResponsibility(name, sampleFiles) {
      const prompt = `Given a software module named "${name}" containing these files:\n${sampleFiles.join("\n")}\n\nDescribe its responsibility in one concise sentence.`;
      const { text } = await generateText({ model: llmModel, prompt });
      return text.trim() || null;
    },
  };
}
