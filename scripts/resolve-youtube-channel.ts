import { resolveYoutubeChannelId } from "../src/sources/youtube-adapter.js";

const channelUrl = process.argv[2];
if (!channelUrl) {
  console.error("Usage: npm run youtube:resolve -- https://www.youtube.com/@handle");
  process.exitCode = 2;
} else {
  try {
    const resolved = await resolveYoutubeChannelId(channelUrl);
    console.log(
      JSON.stringify(
        {
          input: channelUrl,
          ...resolved,
          config: { url: channelUrl, channelId: resolved.channelId },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

