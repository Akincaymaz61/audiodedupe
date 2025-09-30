'use server';

/**
 * @fileOverview Analyzes audio file names to identify potential duplicates and groups them.
 *
 * - autoGroupDuplicates - A function that groups potential duplicate tracks based on AI analysis.
 * - AutoGroupDuplicatesInput - The input type for the autoGroupDuplicates function.
 * - AutoGroupDuplicatesOutput - The return type for the autoGroupDuplicates function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AutoGroupDuplicatesInputSchema = z.object({
  fileList: z.array(
    z.object({
      filePath: z.string().describe('The path to the audio file.'),
    })
  ).describe('A list of file paths to analyze for duplicates.'),
});
export type AutoGroupDuplicatesInput = z.infer<typeof AutoGroupDuplicatesInputSchema>;

const DuplicateGroupSchema = z.object({
  files: z.array(z.string()).describe('List of file paths in this duplicate group'),
  reason: z.string().describe('The reason why these files are considered duplicates'),
});

const AutoGroupDuplicatesOutputSchema = z.object({
  duplicateGroups: z.array(DuplicateGroupSchema).describe('A list of duplicate groups.'),
});
export type AutoGroupDuplicatesOutput = z.infer<typeof AutoGroupDuplicatesOutputSchema>;

export async function autoGroupDuplicates(input: AutoGroupDuplicatesInput): Promise<AutoGroupDuplicatesOutput> {
  return autoGroupDuplicatesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'autoGroupDuplicatesPrompt',
  input: {schema: AutoGroupDuplicatesInputSchema},
  output: {schema: AutoGroupDuplicatesOutputSchema},
  prompt: `You are an AI assistant that analyzes a list of audio file paths and groups potential duplicate tracks together. You will return a list of duplicate groups with the file paths and the reasoning behind the group.

Analyze the following list of files:

{{#each fileList}}
- {{{this.filePath}}}
{{/each}}`,
});

const autoGroupDuplicatesFlow = ai.defineFlow(
  {
    name: 'autoGroupDuplicatesFlow',
    inputSchema: AutoGroupDuplicatesInputSchema,
    outputSchema: AutoGroupDuplicatesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
