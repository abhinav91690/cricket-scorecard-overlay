export interface CricketAPIData {
    values: {
        firstLogo?: string;
        secondLogo?: string;
        batsman1Name?: string;
        batsman1Runs?: string;
        batsman1Balls?: string;
        batsman2Name?: string;
        batsman2Runs?: string;
        batsman2Balls?: string;
        bowlerName?: string;
        bowlerWickets?: string;
        bowlerRuns?: string;
        bowlerOvers?: string;
        isSecondInningsStarted?: string; // "true" or "false"
        t1Name?: string;
        t1Total?: string;
        t1Wickets?: string;
        t1Overs?: string;
        t2Name?: string;
        t2Total?: string;
        t2Wickets?: string;
        t2Overs?: string;
        showMsgForScoreNeeded?: string;
        isMatchEnded?: string; // "0" or "1"
        result?: string;
    };
    balls?: string[];
}

export interface Config {
    REFRESH_RATE: number;
    DEFAULT_CLUB_ID: string;
    LOGO_MAP: { [key: string]: string };
}
