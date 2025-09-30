'use server';

import { autoGroupDuplicates } from '@/ai/flows/auto-group-duplicates';
import type { AutoGroupDuplicatesInput, AutoGroupDuplicatesOutput } from '@/ai/flows/auto-group-duplicates';

const BATCH_SIZE = 1000; // Tek seferde AI'ye gönderilecek dosya sayısı

export async function findDuplicateFiles(input: AutoGroupDuplicatesInput) {
    try {
        const fileList = input.fileList;
        const batches = [];
        for (let i = 0; i < fileList.length; i += BATCH_SIZE) {
            batches.push(fileList.slice(i, i + BATCH_SIZE));
        }

        let allDuplicateGroups: AutoGroupDuplicatesOutput['duplicateGroups'] = [];

        for (const batch of batches) {
            const batchInput: AutoGroupDuplicatesInput = { fileList: batch };
            const result = await autoGroupDuplicates(batchInput);
            if (result.duplicateGroups) {
                allDuplicateGroups = allDuplicateGroups.concat(result.duplicateGroups);
            }
        }
        
        return { success: true, data: { duplicateGroups: allDuplicateGroups } };

    } catch (error) {
        console.error("AI analysis failed:", error);
        let errorMessage = "Yapay zeka analizi sırasında bilinmeyen bir hata oluştu.";
        if (error instanceof Error) {
            if (error.message.includes('503')) {
                errorMessage = "Yapay zeka hizmeti şu anda aşırı yoğun. Lütfen birkaç dakika bekleyip tekrar deneyin.";
            } else if (error.message.includes('429')) {
                errorMessage = "Çok fazla istek gönderildi. Lütfen bir süre bekleyip tekrar deneyin.";
            } else {
                errorMessage = `Bir hata oluştu: ${error.message}`;
            }
        }
        return { success: false, error: errorMessage };
    }
}
