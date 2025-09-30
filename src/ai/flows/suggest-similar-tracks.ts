'use server';

/**
 * @fileOverview This file defines a Genkit flow to suggest similar audio tracks based on file names and folder structure.
 *
 * - suggestSimilarTracks - A function that takes a list of audio file paths and returns a list of suggestions for similar tracks.
 * - SuggestSimilarTracksInput - The input type for the suggestSimilarTracks function.
 * - SuggestSimilarTracksOutput - The output type for the suggestSimilarTracks function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SuggestSimilarTracksInputSchema = z.object({
  filePaths: z.array(z.string()).describe('An array of audio file paths to analyze.'),
});
export type SuggestSimilarTracksInput = z.infer<
  typeof SuggestSimilarTracksInputSchema
>;

const SuggestSimilarTracksOutputSchema = z.array(z.object({
  filePath: z.string().describe('The file path of the suggested similar track.'),
  similarityScore: z.number().describe('A score indicating the similarity between the input track and the suggested track.'),
})).describe('An array of suggestions for similar tracks, with their similarity scores.');
export type SuggestSimilarTracksOutput = z.infer<
  typeof SuggestSimilarTracksOutputSchema
>;

export async function suggestSimilarTracks(
  input: SuggestSimilarTracksInput
): Promise<SuggestSimilarTracksOutput> {
  return suggestSimilarTracksFlow(input);
}

const prompt = ai.definePrompt({
  name: 'suggestSimilarTracksPrompt',
  input: {schema: SuggestSimilarTracksInputSchema},
  output: {schema: SuggestSimilarTracksOutputSchema},
  prompt: `You are an AI assistant that analyzes audio file names and their folder structure to suggest similar tracks.

  Given the following list of file paths, identify potential duplicates or similar tracks based on file name similarity and folder structure.
  Consider slight variations in file names, such as different versions or remixes of the same song.  Output the file path and a similarity score (0-1) to indicate similarity, with 1 being a perfect match.
  Only include files that have a similarity score of 0.7 or higher.

  File Paths:
  {{#each filePaths}}- {{{this}}}
  {{/each}}`,
});

const suggestSimilarTracksFlow = ai.defineFlow(
  {
    name: 'suggestSimilarTracksFlow',
    inputSchema: SuggestSimilarTracksInputSchema,
    outputSchema: SuggestSimilarTracksOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
