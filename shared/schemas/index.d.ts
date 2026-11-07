import { z } from 'zod';
export declare const AnalyzeRequestSchema: z.ZodObject<{
    logText: z.ZodString;
    fileName: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    logText: string;
    fileName?: string | undefined;
}, {
    logText: string;
    fileName?: string | undefined;
}>;
export type AnalyzeRequestInput = z.infer<typeof AnalyzeRequestSchema>;
export declare const OutcomeSubmissionSchema: z.ZodObject<{
    incidentId: z.ZodString;
    status: z.ZodEnum<["proposed", "failed", "passed_unmerged", "verified"]>;
    fixDescription: z.ZodOptional<z.ZodString>;
    ciResult: z.ZodOptional<z.ZodEnum<["passed", "failed"]>>;
    merged: z.ZodOptional<z.ZodBoolean>;
    prLink: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "proposed" | "failed" | "passed_unmerged" | "verified";
    incidentId: string;
    fixDescription?: string | undefined;
    ciResult?: "failed" | "passed" | undefined;
    merged?: boolean | undefined;
    prLink?: string | null | undefined;
    notes?: string | undefined;
}, {
    status: "proposed" | "failed" | "passed_unmerged" | "verified";
    incidentId: string;
    fixDescription?: string | undefined;
    ciResult?: "failed" | "passed" | undefined;
    merged?: boolean | undefined;
    prLink?: string | null | undefined;
    notes?: string | undefined;
}>;
export type OutcomeSubmissionInput = z.infer<typeof OutcomeSubmissionSchema>;
export declare function validateOutcomeStatus(data: OutcomeSubmissionInput): string[];
