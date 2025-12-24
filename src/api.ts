import { CricketAPIData } from './types';

export async function fetchScoreData(apiUrl: string): Promise<CricketAPIData> {
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}
