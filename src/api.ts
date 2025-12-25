import { CricketAPIData } from './types';

/**
 * Fetches the cricket score data from the given API URL.
 * @param apiUrl - The URL to fetch data from.
 * @returns A promise that resolves to the CricketAPIData object.
 * @throws Will throw if the network response is not ok.
 */
export async function fetchScoreData(apiUrl: string): Promise<CricketAPIData> {
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}
