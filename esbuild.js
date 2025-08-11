const esbuild = require("esbuild")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")
const web = process.argv.includes("--platform=web")

const sharedConfig = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    external: ["vscode"],
    logLevel: "info",
}

async function buildDesktop() {
    await esbuild.build({
        ...sharedConfig,
        platform: "node",
        format: "cjs",
        outfile: "dist/desktop/extension.js",
    })
}

async function buildWeb() {
    await esbuild.build({
        ...sharedConfig,
        platform: "browser",
        format: "cjs",
        outfile: "dist/web/extension.js",
        define: {
            global: "globalThis",
        },
    })
}

async function main() {
    if (watch) {
        console.log("[watch] build started")

        const contexts = await Promise.all([
            esbuild.context({
                ...sharedConfig,
                platform: "node",
                format: "cjs",
                outfile: "dist/desktop/extension.js",
            }),
            esbuild.context({
                ...sharedConfig,
                platform: "browser",
                format: "cjs",
                outfile: "dist/web/extension.js",
                define: {
                    global: "globalThis",
                },
            }),
        ])

        await Promise.all([buildDesktop(), buildWeb()])
        console.log("[watch] build finished")

        await Promise.all(contexts.map(ctx => ctx.watch()))
        console.log("Watching for changes...")
    } else {
        await Promise.all([buildDesktop(), buildWeb()])
        console.log("Build complete.")
    }
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
