// Basic Player Interface (Common fields)
export interface Player {
    playerID: number;
    firstName: string;
    lastName: string;
    profilepic_file_path?: string;
    nickName?: string;
    shortName?: string;
    playingRole?: string;
    battingStyle?: string;
    bowlingStyle?: string;
    email?: string;
    isSecondary?: boolean;
    impactPlayerIn?: boolean;
    impactPlayerOut?: boolean;
}

// Batting Stats
export interface BattingStats extends Player {
    matchID: number;
    teamId: number;
    runsScored: number;
    ballsFaced: number;
    fours: number;
    sixers: number;
    howOut?: string;
    wicketTaker1?: string;
    wicketTaker2?: string;
    isOut?: string; // "0" or "1"
    outStringNoLink?: string;
    outStringNickNamesNoLink?: string;
    outStringCustomReq?: string;
    innings: number;
    battingPosition?: number;
}

// Bowling Stats
export interface BowlingStats extends Player {
    matchID: number;
    teamId: number;
    balls: number;
    runs: number;
    wides: number;
    noBalls: number;
    dotBalls: number;
    wickets: number;
    maidens: number;
    hattricks: number;
    innings: number;
}

// Partnership Data
export interface PartnershipData {
    partnershipTotalRuns: string;
    partnershipTeamID: string;
    partnershipBatsman1ID: string;
    partnershipBatsman1Name: string;
    partnershipBatsman1TotalRuns: string;
    partnershipBatsman1Balls: string;
    partnershipBatsman1ProfilePic: string; // URL path often not full URL
    partnershipBatsman2ID: string;
    partnershipBatsman2Name: string;
    partnershipBatsman2TotalRuns: string;
    partnershipBatsman2Balls: string;
    partnershipBatsman2ProfilePic: string;
    partnershipTotalBalls: string;
    partnershipBatsman2ContributionRuns?: string;
    partnershipBatsman2ContributionBalls?: string;
    partnershipBatsman2LastName?: string;
    batsman1DisplayName?: string;
    batsman2DisplayName?: string;
    partnershipBatsman1ContributionBalls?: string;
    partnershipBatsman1ContributionRuns?: string;
    partnershipBatsman1FirstName?: string;
    partnershipBatsman1LastName?: string;
    partnershipBatsman2FirstName?: string;
}

// Main API Response Value Interface
export interface CricketAPIValues {
    // Team & Match Info
    matchId?: string;
    seriesName?: string;
    groundName?: string;
    result?: string;
    shortResult?: string;
    toss?: string;
    tossWon?: string;
    isMatchEnded?: string; // "0" or "1"
    isSecondInningsStarted?: string; // "true" or "false"
    isSuperOver?: boolean | string;
    isDls?: boolean;
    displayNickNameOnOverlay?: boolean;
    totalOvers?: number;
    firstnamefirst?: number | string;
    batsman2LastName?: string;
    batsman1LastName?: string; // Added likely companion
    partnerShip?: { [key: string]: number };
    rrOrRPB?: string;
    lastOutRuns?: string;
    oversOrBalls?: string;
    currentPartnershipMap?: PartnershipData;
    projectedRunRate?: any[];
    liveYouTubeLink?: string;
    lastOUtSixers?: string;

    // Team 1
    t1ID?: number;
    t1Name?: string;
    t1Code?: string;
    t1Logo?: string; // firstLogo in some views
    firstLogo?: string;
    t1Total?: string;
    t1Wickets?: string;
    t1Overs?: string;
    t1RR?: string;
    t1Extras?: string;

    // Team 2
    t2ID?: number;
    t2Name?: string;
    t2Code?: string;
    t2Logo?: string; // secondLogo in some views
    secondLogo?: string;
    t2Total?: string;
    t2Wickets?: string;
    t2Overs?: string;
    t2RR?: string;
    t2Extras?: string;

    // Current Status
    requiredRuns?: string;
    remainingOvers?: string;
    RRR?: string;
    showMsgForScoreNeeded?: string;
    revisedOvers?: number;
    revisedTarget?: number;

    // Current Batsmen (Scorecard View)
    batsman1ID?: number;
    batsman1Name?: string;
    batsman1Runs?: string;
    batsman1Balls?: string;
    batsman1Fours?: string;
    batsman1Sixers?: string;
    batsman1ProfileImange?: string;
    batsman1OutString?: string;

    batsman2ID?: number;
    batsman2Name?: string;
    batsman2Runs?: string;
    batsman2Balls?: string;
    batsman2Fours?: string;
    batsman2Sixers?: string;
    batsman2ProfileImange?: string;
    batsman2OutString?: string;

    // Current Bowler (Scorecard View)
    bowlerID?: number;
    bowlerName?: string;
    bowlerWickets?: string;
    bowlerRuns?: string;
    bowlerOvers?: string;
    bowlerMaidens?: string;
    bowlerProfileImange?: string;

    // Last Out
    lastOutName?: string;
    lastOutString?: string;

    // Lists for Specific Views
    t1Batting?: BattingStats[];
    t2Batting?: BattingStats[];
    t1Bowling?: BowlingStats[];
    t2Bowling?: BowlingStats[];

    // Squad Lists
    t1PlayersList?: Player[];
    t2PlayersList?: Player[];
    t1Players?: string[];
    t2Players?: string[];
    t1PlayerPics?: string[];
    t2PlayerPics?: string[];

    // Misc
    customTextValue?: string;
    manOfTheMatch?: string;
    manOfTheMatchNickName?: string;
    momImagePath?: string;
    lastOutProfileImange?: string;
    bowlerFirstName?: string;
    bowlerLastName?: string;
    bowlerNickName?: string;
    lastOutFours?: string;
    batsman1IsOut?: string;
    batsman2IsOut?: string;
    batsman1NickName?: string;
    batsman2NickName?: string;
    overs?: string;
    lastOutBalls?: string;
    lastOutIsOut?: string;
    lastOutID?: number;
    lastOutFirstName?: string;
    lastOutLastName?: string;
    dots?: number;
    parScore?: string;
    showScoreMsgForOpositTeam?: string;
    fow?: string;
    tTotal?: string;
    careerProfileImage?: string;
    careerPlayerName?: string;
    batsman1FirstName?: string;
    batsman2FirstName?: string;
    tWickets?: string;
    tOvers?: string;
    teamID?: number;
    runrate?: string;
    isSuperOverSecondInningsStarted?: string;
    isTestOr2x?: boolean;
}

export interface CricketAPIData {
    view?: number;
    values: CricketAPIValues;
    balls?: string[];
    isAutoSwitchEnabled?: number;
    comments?: string;
    isSecondInningsStarted?: boolean;
    isSuperOver?: boolean;
    isSuperOverSecondInningsStarted?: boolean;
    is2XCricket?: boolean;
    sponsorsImgPaths?: string[];
    displayNickNameOnOverlay?: boolean;
}

export interface Config {
    REFRESH_RATE: number;
    DEFAULT_CLUB_ID: string;
    LOGO_MAP: { [key: string]: string };
}
