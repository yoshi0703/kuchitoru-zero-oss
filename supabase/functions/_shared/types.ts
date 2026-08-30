import type { MiddlewareHandler } from "hono";

export type JsonObject = Record<string, unknown>;
export type ProviderName =
  | "openai"
  | "gemini"
  | "deepseek"
  | "xai"
  | "anthropic";
export type AiOperation =
  | "connection_test"
  | "interview_turn"
  | "review_generation"
  | "review_rewrite"
  | "review_reply_draft";

export type RpcClient = {
  schema(schema: string): {
    rpc(name: string, params?: JsonObject): PromiseLike<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
    from(table: string): unknown;
  };
  auth: {
    admin: {
      deleteUser(
        userId: string,
      ): PromiseLike<{ error: { message?: string } | null }>;
      signOut(
        accessToken: string,
        scope: "global",
      ): PromiseLike<{ error: { message?: string } | null }>;
    };
  };
};

export type SupabaseRequestContext = {
  supabase: RpcClient;
  supabaseAdmin: RpcClient;
  userClaims: { id: string; email?: string | null } | null;
  jwtClaims: Record<string, unknown> | null;
};

export type AppVariables = {
  requestId: string;
  supabaseContext: SupabaseRequestContext;
};

export type AppEnv = { Variables: AppVariables };
export type AuthMiddleware = MiddlewareHandler<AppEnv>;

export type AiProviderResult = {
  text: string;
  provider: ProviderName;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  generatedCharacters: number;
  providerRequestId: string | null;
  requestId: string;
};

export type InterviewMessage = {
  role: "user" | "assistant";
  content: string;
  sequence: number;
};

export type InterviewContext = {
  storeId: string;
  sessionId: string;
  storeName: string;
  industry: string | null;
  locale: "ja" | "en";
  rating: number | null;
  visitFrequency: string | null;
  structuredAnswers: JsonObject;
  surveyConfig?: JsonObject | null;
  messages: InterviewMessage[];
  currentReview: string | null;
};

export type ReviewReplyTone = "polite" | "warm" | "concise";

/**
 * A deliberately closed input contract for review-reply drafting.
 *
 * Callers cannot supply instructions, system prompts, previous messages, or
 * publishing destinations. The review text is always treated as untrusted
 * source material by providers.
 */
export type ReviewReplyDraftInput = {
  locale?: "ja" | "en";
  rating: number;
  reviewComment: string;
  storeName: string;
  industry: string | null;
  tone: ReviewReplyTone;
};

export type AiProvider = {
  validateCredential(
    apiKey: string,
    requestId: string,
  ): Promise<AiProviderResult>;
  generateInterviewTurn(input: {
    context: InterviewContext;
    model: string;
    requestId: string;
  }): Promise<AiProviderResult & { interviewComplete: boolean }>;
  generateReview(input: {
    context: InterviewContext;
    model: string;
    requestId: string;
  }): Promise<AiProviderResult>;
  rewriteReview(input: {
    context: InterviewContext;
    model: string;
    requestId: string;
    currentReview: string;
  }): Promise<AiProviderResult>;
  draftReviewReply(input: {
    draft: ReviewReplyDraftInput;
    model: string;
    requestId: string;
  }): Promise<AiProviderResult>;
};
