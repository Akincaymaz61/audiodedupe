'use server';

import { autoGroupDuplicates } from '@/ai/flows/auto-group-duplicates';
import type { AutoGroupDuplicatesInput, AutoGroupDuplicatesOutput } from '@/ai/flows/auto-group-duplicates';

const BATCH_SIZE = 1000;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 saniye

// Helper function for exponential backoff
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function findDuplicateFiles(input: AutoGroupDuplicatesInput) {
    const fileList = input.fileList;
    const batches = [];
    for (let i = 0; i < fileList.length; i += BATCH_SIZE) {
        batches.push(fileList.slice(i, i + BATCH_SIZE));
    }

    let allDuplicateGroups: AutoGroupDuplicatesOutput['duplicateGroups'] = [];

    for (const batch of batches) {
        let retries = 0;
        let success = false;
        while (retries < MAX_RETRIES && !success) {
            try {
                const batchInput: AutoGroupDuplicatesInput = { fileList: batch };
                const result = await autoGroupDuplicates(batchInput);
                if (result.duplicateGroups) {
                    allDuplicateGroups = allDuplicateGroups.concat(result.duplicateGroups);
                }
                success = true; // Batch processed successfully
            } catch (error) {
                retries++;
                const isRateLimitError = error instanceof Error && (error.message.includes('503') || error.message.includes('429'));

                if (isRateLimitError && retries < MAX_RETRIES) {
                    const waitTime = INITIAL_RETRY_DELAY * Math.pow(2, retries - 1);
                    console.warn(`AI service is busy. Retrying in ${waitTime / 1000} seconds... (Attempt ${retries}/${MAX_RETRIES})`);
                    await delay(waitTime);
                } else {
                    // Non-retriable error or max retries reached
                    console.error("AI analysis failed after multiple retries:", error);
                    let errorMessage = "Yapay zeka analizi sırasında bilinmeyen bir hata oluştu.";
                    if (error instanceof Error) {
                        if (error.message.includes('503')) {
                            errorMessage = "Yapay zeka hizmeti şu anda aşırı yoğun. Birkaç denemeye rağmen yanıt alınamadı. Lütfen daha sonra tekrar deneyin.";
                        } else if (error.message.includes('429')) {
                            errorMessage = "Çok fazla istek gönderildi ve limit aşıldı. Lütfen bir süre bekleyip tekrar deneyin.";
                        } else {
                            errorMessage = `Bir hata oluştu: ${error.message}`;
                        }
                    }
                    // Throw an error to be caught by the client-side transition
                    throw new Error(errorMessage);
                }
            }
        }
    }
    
    return { success: true, data: { duplicateGroups: allDuplicateGroups } };
}
