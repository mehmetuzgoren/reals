# Live sample data

`verification/seed-sample.mjs` seeds the development deployment `first-mandrill-982` from a plan file and a directory of MP4 clips:

```sh
node verification/seed-sample.mjs verification/seed-plans/jensen.json /absolute/clip/directory [friend_username]
```

It uses only the app's public API: development sign-up/onboarding, friend requests and acceptance, and begin → authenticated MP4 POST → finalize for every take and reply. It does not import rows, bypass authorization, change or reset rounds, delete content or need a deploy key. Files posted through the Convex dashboard would bypass the server checks and could not create the records that unlock feeds, so do not seed that way.

## Plans

- `seed-plans/sample.json`: six mock people on any open round (`sam`, `priya`, `dev`, `maya`, `jordan_lee`, `mira_k`). Every take uses the bundled native placeholder `sample-mock.mp4`. Sam/Priya/Dev/Maya are mutual friends; Dev and Maya also post because replies require a same-round take; Priya, Dev and Maya reply to Sam.
- `seed-plans/jensen.json`: thirteen real iPhone takes for "Should Jensen have been Ousted from Nvidia?". Five friends-only takes are mutual friends with the `demo` login; eight public takes fill For You and pair into Yes/No battles in plan order. It refuses to post unless the current round asks exactly that question.

A plan lists `people` (username, displayName, clip filename, option label or index, `friends` or `public` audience), optional `viewer`, `friends` (all mutual), `replies`, `comments`, `likes` and `votes` (voter, public author). Usernames must be 3–24 lowercase letters, numbers or underscores, so dots become underscores.

Prepare iPhone clips the way the app's export does: portrait H.264 720×1280, one AAC track, faststart MP4, 3–15 seconds and at most 8 MiB. For example:

```sh
ffmpeg -i IN.MOV -map 0:v:0 -map 0:a:0 -t 14.9 -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -pix_fmt yuv420p -crf 23 -maxrate 3500k -bufsize 7000k -c:a aac -ac 1 -movflags +faststart -map_metadata -1 OUT.mp4
```

Clips under three seconds need padding (for example `tpad=stop_mode=clone` with `apad`) or the server rejects them. Personal clips are not committed.

## Credentials and reruns

Generated passwords and session tokens stay at `~/.capy/work/takes-sample-seed/accounts.json` with mode 0600; `TAKES_SEED_STATE` can choose another private location outside the repository and Drive. Keep that file for reruns and never commit, attach or share it. A plan `viewer` (the `demo` login) takes its password from `TAKES_VIEWER_PASSWORD`, so the person who signs in chooses it. Existing usernames with unknown passwords are not adopted. An exclusive `.lock` prevents concurrent runs.

Rerunning in the same round discovers existing takes, replies and comments, checks likes before toggling and upserts votes, so it adds nothing. Each new round relocks feeds; rerun to post fresh takes there. Replies require the replier to have posted in that round.

The optional `friend_username` makes every posting member of the friend group send a friend request. To see friends-only takes, the recipient (and the `demo` login) must accept and post their own take in the current round; For You also requires a take in the round.

## Executed seeds

On 2026-11-16 UTC the sample plan populated "Do you like pineapple on pizza?" with six originals, three replies, one comment, four likes and a Jordan/Mira battle with one vote per side. Reruns passed every authenticated readback and added no originals or replies. Existing `qa_reals_a/b/c` content was unchanged. Native rendering, physical capture, round rollover and recipient friend requests are not established by these API results.
