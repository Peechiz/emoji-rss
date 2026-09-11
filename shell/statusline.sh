# emoji-rss for a bash/sh statusline or prompt.
#
# Same contract as the zsh hook: read the cache, never block, kick off a
# detached refresh when it goes stale.

emoji_rss_cache="${XDG_CACHE_HOME:-$HOME/.cache}/emoji-rss/emoji"
emoji_rss_ttl=1800
emoji_rss_emoji="🔥"

if [ -r "$emoji_rss_cache" ]; then
  cached=$(cat "$emoji_rss_cache" 2>/dev/null)
  [ -n "$cached" ] && emoji_rss_emoji="$cached"
fi

if [ ! -f "$emoji_rss_cache" ] || [ "$(( $(date +%s) - $(stat -f %m "$emoji_rss_cache" 2>/dev/null || echo 0) ))" -gt "$emoji_rss_ttl" ]; then
  command -v emoji-rss >/dev/null 2>&1 && ( emoji-rss check --quiet >/dev/null 2>&1 & ) >/dev/null 2>&1
fi

# $emoji_rss_emoji is now safe to print.
