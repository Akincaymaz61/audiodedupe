'use server';

import { autoGroupDuplicates } from '@/ai/flows/auto-group-duplicates';
import type { AutoGroupDuplicatesInput } from '@/ai/flows/auto-group-duplicates';

export async function findDuplicateFiles(input: AutoGroupDuplicatesInput) {
    try {
        const result = await autoGroupDuplicates(input);
        return { success: true, data: result };
    } catch (error) {
        console.error("AI analysis failed:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during AI analysis.";
        return { success: false, error: `AI analysis failed. Please try again. Details: ${errorMessage}` };
    }
}
