const fs = require('fs');

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

function gvizUrl(sheetId, tabName) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${tabName}&headers=0`;
    return url;
}

async function run() {
    const url = gvizUrl(SHEET_ID, TAB_NAME);
    console.log("Fetching:", url);
    const res = await fetch(url);
    const text = await res.text();
    fs.writeFileSync('gviz_diagnostic.json', text);
    console.log("Saved to gviz_diagnostic.json");
}

run();
