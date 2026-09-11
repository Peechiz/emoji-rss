# emoji-rss -- swap the leading emoji in the zsh prompt based on RSS/Atom feeds.
#
# Source this from ~/.zshrc AFTER `source $ZSH/oh-my-zsh.sh`.
#
# The prompt itself never touches the network and never forks: precmd reads one
# small cache file with zsh builtins, and only when that file goes stale does it
# spawn a detached `emoji-rss check` to refresh it.
#
# Knobs (set before sourcing):
#   EMOJI_RSS_FALLBACK   emoji when no feed has a fresh item   (default 🔥)
#   EMOJI_RSS_TTL        seconds before the cache is stale     (default 1800)
#   EMOJI_RSS_BIN        the CLI to run                        (default emoji-rss)
#   EMOJI_RSS_NO_PROMPT  set to 1 to keep your own PROMPT and just get the
#                        ${EMOJI_RSS_EMOJI} variable to place yourself

zmodload -F zsh/stat b:zstat 2>/dev/null
zmodload zsh/datetime 2>/dev/null

: ${EMOJI_RSS_CACHE:=${XDG_CACHE_HOME:-$HOME/.cache}/emoji-rss/emoji}
: ${EMOJI_RSS_FALLBACK:=🔥}
: ${EMOJI_RSS_TTL:=1800}
: ${EMOJI_RSS_BIN:=emoji-rss}

typeset -g EMOJI_RSS_EMOJI=$EMOJI_RSS_FALLBACK

emoji_rss_precmd() {
  local cached
  local -a st

  # $(<file) is a zsh builtin read -- no subshell, no fork.
  if [[ -r $EMOJI_RSS_CACHE ]]; then
    cached=$(<$EMOJI_RSS_CACHE)
    EMOJI_RSS_EMOJI=${cached:-$EMOJI_RSS_FALLBACK}
  else
    EMOJI_RSS_EMOJI=$EMOJI_RSS_FALLBACK
  fi

  (( $+commands[$EMOJI_RSS_BIN] )) || return 0

  # Stale (or missing) cache: refresh in the background and move on. The check
  # writes the cache even when every fetch fails, so a broken network backs off
  # to one attempt per TTL rather than one per prompt.
  if [[ -r $EMOJI_RSS_CACHE ]] && zstat -A st +mtime -- $EMOJI_RSS_CACHE 2>/dev/null; then
    (( EPOCHSECONDS - st[1] < EMOJI_RSS_TTL )) && return 0
  fi
  ( command $EMOJI_RSS_BIN check --quiet >/dev/null 2>&1 & ) >/dev/null 2>&1
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd emoji_rss_precmd

# Force a refresh now, then redraw the prompt.
emoji-rss-refresh() {
  command $EMOJI_RSS_BIN check --force --quiet >/dev/null 2>&1
  emoji_rss_precmd
  [[ -o zle ]] && zle .reset-prompt 2>/dev/null
  print -r -- "$EMOJI_RSS_EMOJI"
}

if [[ -z $EMOJI_RSS_NO_PROMPT ]]; then
  # Mirrors the oh-my-zsh "kolo" PROMPT with its hardcoded 🔥 swapped for the
  # variable. prompt_subst (set by kolo) re-expands it on every render, so the
  # precmd hook above is all that has to run.
  setopt prompt_subst
  PROMPT='${EMOJI_RSS_EMOJI} %B%F{magenta}%c%B%F{green}${vcs_info_msg_0_}%B%F{magenta} %{$reset_color%}% $ '
fi
