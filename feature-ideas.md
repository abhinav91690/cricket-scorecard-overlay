# Feature Ideas

Potential features based on unused API data and UX improvements.

## 1. Current Run Rate Display
`t1RR`/`t2RR` and `RRR` (required run rate) are available but never shown. Adding CRR to the scorecard pill and RRR to the second innings bar would be a quick, high-value add.

## 2. Current Partnership Bar
`currentPartnershipMap` has full partnership data (runs, balls, each batsman's contribution). A small bar between the batsmen and scorecard pill showing "Partnership: 45 (32)" would be useful context.

## 3. Last Wicket Info
`lastOutName`, `lastOutString`, `lastOutRuns`, `lastOutBalls` are all available. A brief dismissal popup or ticker ("Kohli c Buttler b Archer 45(30)") that fades in after a wicket would add broadcast polish.

## 4. Player Profile Pictures
`batsman1ProfileImange`, `batsman2ProfileImange`, `bowlerProfileImange` exist in the API. Showing small circular headshots next to player names would make it feel more like a real broadcast.

## 5. Toss / Match Info Banner
`toss`, `seriesName`, `groundName` are unused. A pre-match info strip showing "CSK won toss and elected to bat • MA Chidambaram Stadium" would fill the gap before the first ball.

## 6. Extras Breakdown
`t1Extras`/`t2Extras` could be shown as a small detail in the second innings bar or as a tooltip.

## 7. Nickname Support
`displayNickNameOnOverlay` flag and nickname fields exist but are ignored. A `?nicknames=true` param to show short names would be easy.

## 8. Man of the Match
`manOfTheMatch`, `momImagePath` are available. When the match ends, showing a MOM card alongside the result would be a nice touch.

## 9. Sponsor Carousel
`sponsorsImgPaths` is an array in the API. Could rotate sponsor logos in the overlay image slot.

## 10. Configurable Refresh Rate
Currently hardcoded at 5s. A `?refresh=3000` param would let streamers tune responsiveness.
