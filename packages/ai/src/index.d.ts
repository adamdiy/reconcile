import { z } from 'zod';
export interface MappingSuggestionContext {
    prices: Array<{
        id: string;
        nickname?: string;
        unitAmount?: number;
        currency?: string;
    }>;
    capabilities: string[];
}
export declare const MappingSuggestionSchema: z.ZodObject<{
    priceId: z.ZodString;
    capabilities: z.ZodArray<z.ZodString, "many">;
    rationale: z.ZodString;
}, "strip", z.ZodTypeAny, {
    priceId: string;
    capabilities: string[];
    rationale: string;
}, {
    priceId: string;
    capabilities: string[];
    rationale: string;
}>;
export type MappingSuggestion = z.infer<typeof MappingSuggestionSchema>;
export declare const SuggestionResultSchema: z.ZodObject<{
    suggestions: z.ZodArray<z.ZodObject<{
        priceId: z.ZodString;
        capabilities: z.ZodArray<z.ZodString, "many">;
        rationale: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        priceId: string;
        capabilities: string[];
        rationale: string;
    }, {
        priceId: string;
        capabilities: string[];
        rationale: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    suggestions: {
        priceId: string;
        capabilities: string[];
        rationale: string;
    }[];
}, {
    suggestions: {
        priceId: string;
        capabilities: string[];
        rationale: string;
    }[];
}>;
export type SuggestionResult = z.infer<typeof SuggestionResultSchema>;
export interface MappingSuggester {
    suggest(ctx: MappingSuggestionContext): Promise<{
        suggestions: MappingSuggestion[];
        provider: string;
    }>;
}
export declare function filterValidSuggestions(ctx: MappingSuggestionContext, raw: unknown): MappingSuggestion[];
export declare class StubSuggester implements MappingSuggester {
    suggest(ctx: MappingSuggestionContext): Promise<{
        suggestions: {
            priceId: string;
            capabilities: string[];
            rationale: string;
        }[];
        provider: string;
    }>;
}
export declare class OpenAICompatibleSuggester implements MappingSuggester {
    private baseUrl;
    private apiKey;
    private model;
    constructor(baseUrl: string, apiKey: string, model?: string);
    suggest(ctx: MappingSuggestionContext): Promise<{
        suggestions: {
            priceId: string;
            capabilities: string[];
            rationale: string;
        }[];
        provider: string;
    }>;
}
export declare class AnthropicSuggester implements MappingSuggester {
    private apiKey;
    private model;
    constructor(apiKey: string, model?: string);
    suggest(ctx: MappingSuggestionContext): Promise<{
        suggestions: {
            priceId: string;
            capabilities: string[];
            rationale: string;
        }[];
        provider: string;
    }>;
}
export declare function createSuggester(env?: NodeJS.ProcessEnv): MappingSuggester;
//# sourceMappingURL=index.d.ts.map