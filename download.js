const { launch, getStream } = require("puppeteer-stream")
const ffmpeg = require("fluent-ffmpeg")
const fs = require("fs")
const yargs = require("yargs")

async function waitUntilVictory(timeout, page) {
    let ret = new Promise(async (resolve, reject) => {
        setTimeout(() => {
            if (!ret.isResolved) {
                reject()
            }
        }, timeout)

        await checkForVictory(page)
        resolve()
    })
    return ret
}

async function checkForVictory(page) {
    try {
        victory = await page.$$eval('div[class="battle-history"]', (els) =>
            els.map((e) => e.textContent)
        )
        victory = victory[victory.length - 1].endsWith(" won the battle!")

        if (!victory) {
            // Wait for 1 second before calling checkForVictory again
            await new Promise((resolve) => setTimeout(resolve, 1000))
            await checkForVictory(page)
        } else {
            return
        }
    } catch {}
}

// Create a FFmpeg command to fix the metadata
async function fixwebm(fileId) {
    return new Promise((resolve, reject) => {
        const command = ffmpeg(`./replays/replay-${fileId}-temp.webm`)
            .withVideoCodec("copy")
            .withAudioCodec("copy") // Copy the video and audio streams without re-encoding
            .output(`./replays/replay-${fileId}.webm`)
            .on("end", () => {
                resolve()
            })
            .on("error", (err) => {
                console.error("Error fixing metadata:", err)
                reject(err)
            })

        command.run()
    })
}

async function download(link, browser, nomusic, noaudio, theme, speed) {
    if (
        !(
            link.startsWith("https://replay.pokemonshowdown.com/") ||
            link.startsWith("http://replay.pokemonshowdown.com/")
        ) &&
        !(link.endsWith(".json") || link.endsWith(".log"))
    )
        return console.log(`Invalid link: ${link}`)

    const response = await fetch(link + ".json")
    if (!response.ok) {
        console.log(
            `Unable to join the url. Please ensure ${link} is a valid showdown replay.`
        )
        return
    }
    const data = await response.json()
    const matches = Array.from(data.log.matchAll(/\n\|turn\|(\d+)\n/g))
    const totalTurns = parseInt(matches[matches.length - 1][1])
    const fileId = generateRandom()
    try {
        const file = fs.createWriteStream(
            `./replays/replay-${fileId}-temp.webm`
        )
        const page = await browser.newPage()
        await page.setViewport({ width: 1920, height: 1080 }) // 1920 x 1080 screen resolution
        await page.goto(link, {
            waitUntil: "load",
        })
        await page.addStyleTag({
            content: `
                .pfx-panel {
                    position: absolute !important;
                    top: -9px !important;
                    left: -9px !important;
                    height: auto !important;
                    overflow: hidden auto !important;
                    display: block !important;
                    width: 1200px !important;
                }
                `,
        })
        await page.waitForSelector(".playbutton")
        // Customization
        // Default: music: yes, audio: yes, video: yes (why would anyone want to not record video..), speed: normal, color scheme: light, recordChat: yes
        // Example for if you want your replay speed to be changed dynamically per individual video on total turns basis:-
        // if (totalTurns > 20) speed = "fast"
        switch (speed) {
            case "hyperfast":
                await page.click('button[value="hyperfast"]')
                break
            case "fast":
                await page.click('button[value="fast"]')
                break
            case "slow":
                await page.click('button[value="slow"]')
                break
            case "reallyslow":
                await page.click('button[value="reallyslow"]')
                break
        }
        if (nomusic) await page.click('button[value="off"]')
        if (theme === "dark") await page.click('button[value="dark"]')

        const stream = await getStream(page, {
            audio: !noaudio,
            video: true,
        })
        await page.click('button[name="play"]')
        stream.pipe(file)

        console.log(
            `Opened replay ${data.p1} vs ${data.p2} (${
                data.format
            })\nSaving Replay..  (this may take a while.. preferably not more than ${(
                (totalTurns * 7) /
                60
            ).toFixed(2)} minutes)\n[*estimates are calced at normal speed*]`
        ) // the estimate is based upon my observation for "normal" speed replays

        // Start checking for victory, upto 5 minutes (aka record time limit)
        // You might want to modify this for super long videos as with endless battle clause, a battle can last upto 1000 turns which is approx 1 hour and 56 minutes at normal speed
        try {
            await waitUntilVictory(150000, page)
        } catch {}
        // Wait for 2 seconds so that the battle has completely ended as we read the text earlier than it getting fully animated
        await new Promise((resolve) => setTimeout(resolve, 1500))

        stream.destroy()
        file.close()

        console.log(`Finished recording ${link}`)
        await fixwebm(fileId) // metadata needs to be added for seeking video
        console.log(
            `Recording Saved!\nLocation -> replays/replay-${fileId}.webm`
        )
        try {
            fs.unlinkSync(`./replays/replay-${fileId}-temp.webm`)
        } catch {}

        try {
            await page.close()
        } catch (error) {
            console.log(error)
        }
    } catch (err) {
        try {
            fs.unlinkSync(`./replays/replay-${fileId}-temp.webm`)
        } catch {}
        console.log(`An error occured while downloading ${link}\n` + err)
    }
}

const generateRandom = () =>
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(23).substring(2, 5) // simplistic simple https://stackoverflow.com/a/71262982/14393614

const argv = yargs(process.argv.slice(2))
    .usage('Usage: $0 -l "[replays]"')
    .demandOption(["links"])
    .option("links", {
        alias: "l",
        describe: "List of ps replay links separated by a comma or space",
        type: "string",
        demandOption: true,
    })
    .option("nomusic", {
        describe: "Disable music",
        type: "boolean",
        default: false,
    })
    .option("noaudio", {
        describe: "Disable audio (disables music too obviously)",
        type: "boolean",
        default: false,
    })
    .option("speed", {
        alias: "s",
        describe: "Speed (really fast, fast, normal, slow, really slow)",
        choices: ["normal", "fast", "slow", "really slow", "really fast"],
        default: "normal",
    })
    .option("nochat", {
        describe: "Will not record chat",
        type: "boolean",
        default: false,
    })
    .option("theme", {
        alias: "t",
        describe: "Color Scheme",
        choices: ["light", "dark"],
        default: "light",
    })
    .option("bulk", {
        alias: "b",
        describe: 'Bulk record option (a number >= 1 or "all")',
        type: "string",
        default: "all",
    })
    .help("h")
    .alias("h", "help").argv

;(async () => {
    const links = argv.links.split(/[\s,]+/).filter(Boolean) // https://stackoverflow.com/a/23728809/14393614
    const nomusic = argv.nomusic
    const noaudio = argv.noaudio
    const speed = argv.speed
    const nochat = argv.nochat
    const theme = argv.theme
    let bulk = argv.bulk

    if (parseInt(bulk) && bulk >= 1) {
        bulk = parseInt(bulk)
        if (bulk > links.length) {
            bulk = links.length
        }
    } else if (bulk !== "all") {
        console.log(
            `Invalid value: Argument bulk, Given: "${bulk}", Takes: all/a number 1 or above.`
        )
        process.exit()
    }
    console.log("--Booting Downloader--")
    try {
        fs.mkdirSync("./replays")
    } catch {}
    const toRecord = []
    if (links.length > 1) {
        if (bulk === "all" || bulk > 1) {
            console.log(
                `Bulk recording is enabled, thus ${bulk} videos will be recorded simultaneously. (This may cause poorer recorded quality)\n(Optional) Set bulk to 1 (via -b 1) to record only one video at a time for optimum quality.\n[node download.js -h to view syntax, all arguments]`
            )
            if (bulk === "all") toRecord.push(links)
            else {
                // chunk the links into smaller lists of size -> bulk
                for (let i = 0; i < links.length; i += bulk) {
                    toRecord.push()
                }
            }
        } else
            console.log(
                "Bulk recording is disabled (set to 1). Thus replays will be downloaded one at a time."
            )
    }

    width = nochat ? 655 : 1175
    height = 540
    const args = [`--window-size=${width},${height}`]
    if (noaudio) args.push(`--mute-audio`)

    const browser = await launch({
        executablePath: require("puppeteer").executablePath(),
        defaultViewport: null,
        args: args,
    })
    if (links.length > 1 && (bulk === "all" || bulk > 1)) {
        let bulkRecord = []
        for (let recordLinks of toRecord) {
            for (let link of recordLinks)
                bulkRecord.push(
                    download(link, browser, nomusic, noaudio, theme, speed)
                )

            await Promise.all(bulkRecord) // wait on all recordings to occur simultaneously
            bulkRecord = [] // reset array
        }
    } else {
        for (let link of links)
            await download(link, browser, nomusic, noaudio, theme, speed) // record one by one
    }
    console.log("Thankyou for utilising Showdown Replay Downloader!!")
    try {
        await browser.close()
    } catch {}
    try {
        process.exit()
    } catch {}
})()
