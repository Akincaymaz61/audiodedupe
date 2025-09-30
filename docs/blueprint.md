# **App Name**: Audio Dedupe

## Core Features:

- Directory Scan: Recursively scan user-specified directories for audio files, indexing them for analysis.
- Similarity Analysis: Analyze audio file names (using Levenshtein distance, for example) to identify potential duplicates or similar tracks, taking into account folder names for context. This AI powered tool decides when a file should be flagged as a duplicate based on its similarity score relative to other scanned files.
- Duplicate Grouping: Group identified duplicates and near-duplicates into clusters for user review.
- Interactive Review: Present identified duplicate groups to the user through an intuitive interface, displaying filenames and locations.
- Automated Cleanup: Allow the user to delete unwanted files to clear up the space on their machine
- Selective Deletion: Enable users to select and delete specific files within a duplicate group, providing flexibility in managing their music library.

## Style Guidelines:

- Primary color: Soft purple (#A080E0) to give the interface a sophisticated, music-related feel.
- Background color: Very light gray (#F0F0F0), near-white, to keep focus on audio files and not fatigue the eye during long usage.
- Accent color: Muted teal (#70A0A0) for buttons and interactive elements.
- Body and headline font: 'PT Sans' (sans-serif) for a clear and modern look throughout the application.
- Use clean and minimalist icons to represent actions such as 'scan', 'delete', and 'group'. Ensure icons are intuitive and universally recognizable.
- Employ a grid-based layout to organize scanned files and duplicate groups. The layout should be responsive, adapting to different screen sizes and resolutions.
- Use subtle animations and transitions when displaying search results or deleting duplicate files, providing a smoother user experience.