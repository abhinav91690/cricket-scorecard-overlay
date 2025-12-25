// Basic Player Interface (Common fields)
export interface Player {
    /** Unique identifier for the player */
    playerID: number;
    /** Player's first name */
    firstName: string;
    /** Player's last name */
    lastName: string;
    /** URL or path to the player's profile picture */
    profilepic_file_path?: string;
    /** Player's nickname */
    nickName?: string;
    /** Short version of the player's name */
    shortName?: string;
    /** Role in the team (e.g., "Batsman", "Bowler", "All-rounder") */
    playingRole?: string;
    /** Batting style (e.g., "Right Handed Bat") */
    battingStyle?: string;
    /** Bowling style (e.g., "Right-arm medium") */
    bowlingStyle?: string;
    /** Player's email address */
    email?: string;
    /** Whether the player is a substitute or secondary player */
    isSecondary?: boolean;
    /** Whether the player came in as an impact player */
    impactPlayerIn?: boolean;
    /** Whether the player was substituted out as an impact player */
    impactPlayerOut?: boolean;
}

// Batting Stats
export interface BattingStats extends Player {
    /** ID of the match */
    matchID: number;
    /** ID of the team */
    teamId: number;
    /** Total runs scored by the batsman */
    runsScored: number;
    /** Total balls faced by the batsman */
    ballsFaced: number;
    /** Number of fours hit */
    fours: number;
    /** Number of sixes hit */
    sixers: number;
    /** Description of how the batsman got out */
    howOut?: string;
    /** Name of the primary wicket taker */
    wicketTaker1?: string;
    /** Name of the secondary wicket taker (e.g., catcher) */
    wicketTaker2?: string;
    /** Whether the batsman is out ("1") or not ("0") */
    isOut?: string;
    /** Formatted string describing the dismissal without HTML links */
    outStringNoLink?: string;
    /** Formatted string describing the dismissal using nicknames without HTML links */
    outStringNickNamesNoLink?: string;
    /** Custom requirement string for dismissal */
    outStringCustomReq?: string;
    /** Innings number (1 or 2) */
    innings: number;
    /** Position in the batting order */
    battingPosition?: number;
}

// Bowling Stats
export interface BowlingStats extends Player {
    /** ID of the match */
    matchID: number;
    /** ID of the team */
    teamId: number;
    /** Total balls bowled */
    balls: number;
    /** Total runs conceded */
    runs: number;
    /** Number of wide balls bowled */
    wides: number;
    /** Number of no balls bowled */
    noBalls: number;
    /** Number of dot balls bowled */
    dotBalls: number;
    /** Number of wickets taken */
    wickets: number;
    /** Number of maiden overs bowled */
    maidens: number;
    /** Number of hat-tricks taken */
    hattricks: number;
    /** Innings number (1 or 2) */
    innings: number;
}

// Partnership Data
export interface PartnershipData {
    /** Total runs scored in the partnership */
    partnershipTotalRuns: string;
    /** Team ID for the partnership */
    partnershipTeamID: string;
    /** ID of the first batsman in the partnership */
    partnershipBatsman1ID: string;
    /** Name of the first batsman */
    partnershipBatsman1Name: string;
    /** Total runs scored by the first batsman in this partnership */
    partnershipBatsman1TotalRuns: string;
    /** Balls faced by the first batsman in this partnership */
    partnershipBatsman1Balls: string;
    /** Profile picture URL for the first batsman */
    partnershipBatsman1ProfilePic: string; // URL path often not full URL
    /** ID of the second batsman in the partnership */
    partnershipBatsman2ID: string;
    /** Name of the second batsman */
    partnershipBatsman2Name: string;
    /** Total runs scored by the second batsman in this partnership */
    partnershipBatsman2TotalRuns: string;
    /** Balls faced by the second batsman in this partnership */
    partnershipBatsman2Balls: string;
    /** Profile picture URL for the second batsman */
    partnershipBatsman2ProfilePic: string;
    /** Total balls in the partnership */
    partnershipTotalBalls: string;
    /** Runs contributed by the second batsman */
    partnershipBatsman2ContributionRuns?: string;
    /** Balls faced by the second batsman */
    partnershipBatsman2ContributionBalls?: string;
    /** Last name of the second batsman */
    partnershipBatsman2LastName?: string;
    /** Display name of the first batsman */
    batsman1DisplayName?: string;
    /** Display name of the second batsman */
    batsman2DisplayName?: string;
    /** Balls faced by the first batsman */
    partnershipBatsman1ContributionBalls?: string;
    /** Runs contributed by the first batsman */
    partnershipBatsman1ContributionRuns?: string;
    /** First name of the first batsman */
    partnershipBatsman1FirstName?: string;
    /** Last name of the first batsman */
    partnershipBatsman1LastName?: string;
    /** First name of the second batsman */
    partnershipBatsman2FirstName?: string;
}

// Main API Response Value Interface
export interface CricketAPIValues {
    // Team & Match Info
    /** ID of the match (string format) */
    matchId?: string;
    /** Name of the series/tournament */
    seriesName?: string;
    /** Name of the ground/venue */
    groundName?: string;
    /** Description of the match result */
    result?: string;
    /** Short summary of the result */
    shortResult?: string;
    /** Formatted string describing the toss result (e.g., "TEAM WON TOSS AND...") */
    toss?: string;
    /** Code/Abbreviation of the team that won the toss */
    tossWon?: string;
    /** Whether the match has ended ("1") or not ("0") */
    isMatchEnded?: string;
    /** Whether the second innings has started ("true" or "false") */
    isSecondInningsStarted?: string;
    /** Whether it is a super over match */
    isSuperOver?: boolean | string;
    /** Whether DLS method is being used */
    isDls?: boolean;
    /** Whether to display nicknames on the overlay */
    displayNickNameOnOverlay?: boolean;
    /** Total overs in the match (e.g., 20) */
    totalOvers?: number;
    /** Helper field for name formatting (first name first) */
    firstnamefirst?: number | string;
    /** Last name of the second batsman */
    batsman2LastName?: string;
    /** Last name of the first batsman */
    batsman1LastName?: string;
    /** Map of partnership stats (key: position/id, value: runs/stats) */
    partnerShip?: { [key: string]: number };
    /** Label for Run Rate or Runs Per Ball (e.g. "RR" or "RPB") */
    rrOrRPB?: string;
    /** Runs scored on the delivery when the last wicket fell */
    lastOutRuns?: string;
    /** Label for "OVERS" or "BALLS" depending on match type */
    oversOrBalls?: string;
    /** Detailed partnership data object */
    currentPartnershipMap?: PartnershipData;
    /** Array for projected run rate calculations */
    projectedRunRate?: any[];
    /** URL for the live YouTube stream */
    liveYouTubeLink?: string;
    /** Number of sixes hit by the batsman who just got out */
    lastOUtSixers?: string;

    // Team 1
    /** ID of Team 1 */
    t1ID?: number;
    /** Name of Team 1 */
    t1Name?: string;
    /** Short code/abbreviation for Team 1 */
    t1Code?: string;
    /** Standard logo URL for Team 1 */
    t1Logo?: string;
    /** Alternate logo URL for Team 1 (used in some views) */
    firstLogo?: string;
    /** Total score for Team 1 (formatted string) */
    t1Total?: string;
    /** Total wickets lost by Team 1 */
    t1Wickets?: string;
    /** Overs played by Team 1 */
    t1Overs?: string;
    /** Run rate for Team 1 */
    t1RR?: string;
    /** Extras conceded by Team 1 */
    t1Extras?: string;

    // Team 2
    /** ID of Team 2 */
    t2ID?: number;
    /** Name of Team 2 */
    t2Name?: string;
    /** Short code/abbreviation for Team 2 */
    t2Code?: string;
    /** Standard logo URL for Team 2 */
    t2Logo?: string;
    /** Alternate logo URL for Team 2 (used in some views) */
    secondLogo?: string;
    /** Total score for Team 2 (formatted string) */
    t2Total?: string;
    /** Total wickets lost by Team 2 */
    t2Wickets?: string;
    /** Overs played by Team 2 */
    t2Overs?: string;
    /** Run rate for Team 2 */
    t2RR?: string;
    /** Extras conceded by Team 2 */
    t2Extras?: string;

    // Current Status
    /** Runs required to win */
    requiredRuns?: string;
    /** Overs remaining in the innings */
    remainingOvers?: string;
    /** Required Run Rate */
    RRR?: string;
    /** Message to show regarding score needed (e.g., "Need 10 runs in 5 balls") */
    showMsgForScoreNeeded?: string;
    /** Revised total overs if match is shortened */
    revisedOvers?: number;
    /** Revised target score if DLS is applied */
    revisedTarget?: number;

    // Current Batsmen (Scorecard View)
    /** ID of the batsman on strike */
    batsman1ID?: number;
    /** Name of the batsman on strike */
    batsman1Name?: string;
    /** Runs scored by the batsman on strike */
    batsman1Runs?: string;
    /** Balls faced by the batsman on strike */
    batsman1Balls?: string;
    /** Fours hit by the batsman on strike */
    batsman1Fours?: string;
    /** Sixes hit by the batsman on strike */
    batsman1Sixers?: string;
    /** Profile image path for the batsman on strike */
    batsman1ProfileImange?: string;
    /** Out string for the batsman on strike (e.g. "not out") */
    batsman1OutString?: string;

    /** ID of the non-striker */
    batsman2ID?: number;
    /** Name of the non-striker */
    batsman2Name?: string;
    /** Runs scored by the non-striker */
    batsman2Runs?: string;
    /** Balls faced by the non-striker */
    batsman2Balls?: string;
    /** Fours hit by the non-striker */
    batsman2Fours?: string;
    /** Sixes hit by the non-striker */
    batsman2Sixers?: string;
    /** Profile image path for the non-striker */
    batsman2ProfileImange?: string;
    /** Out string for the non-striker (e.g. "not out") */
    batsman2OutString?: string;

    // Current Bowler (Scorecard View)
    /** ID of the current bowler */
    bowlerID?: number;
    /** Name of the current bowler */
    bowlerName?: string;
    /** Wickets taken by the current bowler */
    bowlerWickets?: string;
    /** Runs conceded by the current bowler */
    bowlerRuns?: string;
    /** Overs bowled by the current bowler */
    bowlerOvers?: string;
    /** Maiden overs bowled by the current bowler */
    bowlerMaidens?: string;
    /** Profile image path for the current bowler */
    bowlerProfileImange?: string;

    // Last Out
    /** Name of the last batsman to get out */
    lastOutName?: string;
    /** Description of the dismissal */
    lastOutString?: string;

    // Lists for Specific Views
    /** Batting stats list for Team 1 */
    t1Batting?: BattingStats[];
    /** Batting stats list for Team 2 */
    t2Batting?: BattingStats[];
    /** Bowling stats list for Team 1 */
    t1Bowling?: BowlingStats[];
    /** Bowling stats list for Team 2 */
    t2Bowling?: BowlingStats[];

    // Squad Lists
    /** Full player list for Team 1 */
    t1PlayersList?: Player[];
    /** Full player list for Team 2 */
    t2PlayersList?: Player[];
    /** List of player names for Team 1 */
    t1Players?: string[];
    /** List of player names for Team 2 */
    t2Players?: string[];
    /** List of player profile pics for Team 1 */
    t1PlayerPics?: string[];
    /** List of player profile pics for Team 2 */
    t2PlayerPics?: string[];

    // Misc
    /** Custom text value for specific overlays */
    customTextValue?: string;
    /** Man of the Match name */
    manOfTheMatch?: string;
    /** Man of the Match nickname */
    manOfTheMatchNickName?: string;
    /** Man of the Match image path */
    momImagePath?: string;
    /** Profile image of the last batsman out */
    lastOutProfileImange?: string;
    /** First name of the bowler */
    bowlerFirstName?: string;
    /** Last name of the bowler */
    bowlerLastName?: string;
    /** Nickname of the bowler */
    bowlerNickName?: string;
    /** Number of fours by the last batsman out */
    lastOutFours?: string;
    /** Is batsman 1 out? */
    batsman1IsOut?: string;
    /** Is batsman 2 out? */
    batsman2IsOut?: string;
    /** Nickname of batsman 1 */
    batsman1NickName?: string;
    /** Nickname of batsman 2 */
    batsman2NickName?: string;
    /** Current overs formatted string */
    overs?: string;
    /** Balls faced by last out batsman */
    lastOutBalls?: string;
    /** Is last out batsman out? */
    lastOutIsOut?: string;
    /** ID of the last out batsman */
    lastOutID?: number;
    /** First name of last out batsman */
    lastOutFirstName?: string;
    /** Last name of last out batsman */
    lastOutLastName?: string;
    /** Number of dot balls in current over/spell */
    dots?: number;
    /** Par score for DLS/Projected */
    parScore?: string;
    /** Message to show for the opposition team */
    showScoreMsgForOpositTeam?: string;
    /** Fall of wickets string */
    fow?: string;
    /** Team total string (duplicate/alias) */
    tTotal?: string;
    /** Career profile image path */
    careerProfileImage?: string;
    /** Career player name */
    careerPlayerName?: string;
    /** First name of batsman 1 */
    batsman1FirstName?: string;
    /** First name of batsman 2 */
    batsman2FirstName?: string;
    /** Total wickets (duplicate/alias) */
    tWickets?: string;
    /** Total overs (duplicate/alias) */
    tOvers?: string;
    /** Team ID (duplicate/alias) */
    teamID?: number;
    /** Run rate (duplicate/alias) */
    runrate?: string;
    /** Is super over second innings started (string) */
    isSuperOverSecondInningsStarted?: string;
    /** Is test match or 2X cricket */
    isTestOr2x?: boolean;
}

// Top-level API Data Structure
export interface CricketAPIData {
    /** The view ID determining the overlay layout */
    view?: number;
    /** The core data values for the overlay */
    values: CricketAPIValues;
    /** Array of recent ball outcomes/commentary */
    balls?: string[];
    /** Whether auto-switching views is enabled (1 or 0) */
    isAutoSwitchEnabled?: number;
    /** Additional comments or info */
    comments?: string;
    /** Whether the second innings has started */
    isSecondInningsStarted?: boolean;
    /** Whether it is a super over */
    isSuperOver?: boolean;
    /** Whether the second innings of the super over has started */
    isSuperOverSecondInningsStarted?: boolean;
    /** Whether 2X cricket rules apply */
    is2XCricket?: boolean;
    /** Paths to sponsor images */
    sponsorsImgPaths?: string[];
    /** Whether to display nicknames */
    displayNickNameOnOverlay?: boolean;
}

// Application Configuration Interface
export interface Config {
    /** Refresh rate for polling the API (in milliseconds) */
    REFRESH_RATE: number;
    /** Default CricClubs club ID */
    DEFAULT_CLUB_ID: string;
    /** Map of team names/codes to logo URLs */
    LOGO_MAP: { [key: string]: string };
}
