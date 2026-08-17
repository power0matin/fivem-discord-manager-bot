# Command Reference

Slash commands are the preferred interface. Legacy prefix commands use `PREFIX` (default `.`).

Administrative commands use `ALLOWED_ROLE_IDS` when configured; otherwise they require Discord **Manage Server** permission.

## Stream Notifier

### Slash

```text
/setup wizard
/setup show
/setup test
```

### Prefix

```text
.help
.config
.health
.tick
.export [all|kick|twitch]
.set channel <#channel|id|this>
.set mentionhere <on|off>
.set regex <pattern>
.set interval <10..3600>
.set discovery <on|off>
.set discoveryTwitchPages <1..50>
.set discoveryKickLimit <1..100>
.set twitchGameId <id>
.set kickCategoryName <name>
.refresh kickCategory
.k list
.k add <slug> [@user|id]
.k addmany <slug...>
.k setmention <slug> <@user|id|none>
.k remove <slug>
.k clear --yes
.k status <slug>
.t list
.t add <login> [@user|id]
.t addmany <login...>
.t setmention <login> <@user|id|none>
.t remove <login>
.t clear --yes
.t status <login>
```

Unsafe nested-quantifier regexes are rejected to protect the Node event loop.

## FiveM

```text
/fivem toggle enabled:<true|false>
/fivem set-endpoint url:<http(s)://host:port>
/fivem set-channel channel:<text-channel>
/fivem set-interval seconds:<60..3600>
/fivem set-title title:<text>
/fivem set-description text:<text>
/fivem set-banner [url:<http(s)>] [clear:true]
/fivem set-website url:<http(s)> [label:<text>]
/fivem set-connect url:<http(s)|fivem://...> [label:<text>]
/fivem set-connect-command command:<text>
/fivem set-restart-times [times:"HH:MM,HH:MM"] [clear:true]
/fivem set-voice-status [channel:<voice>] [clear:true]
/fivem set-scheduled-events enabled:<true|false>
/fivem status
/fivem show
```

Configured restart times use the process timezone (`TZ` may be set in production).

## Tickets

```text
/tickets toggle enabled:<true|false>
/tickets set-log-channel channel:<text-channel>
/tickets clear-log-channel
/tickets panel channel:<text-channel> [title] [description] [footer] [buttons_per_row]
/tickets type-add key:<key> label:<label> category:<category> [emoji]
/tickets type-remove key:<key>
/tickets type-list
/tickets type-set-category key:<key> category:<category>
/tickets type-staff-role key:<key> action:<add|remove|clear> [role]
/tickets type-mention-role key:<key> action:<add|remove|clear> [role]
/tickets type-set-voice key:<key> enabled:<true|false> [voice]
/tickets claim
/tickets assign user:<user>
/tickets unassign
/tickets close [reason]
/tickets show
```

Private ticket creation requires **Manage Channels + Manage Roles**. The bot fails closed if private overwrites cannot be established.

## Welcome

```text
/welcome toggle enabled:<true|false>
/welcome set-channel channel:<text-channel>
/welcome set-title title:<text>
/welcome set-message template:<text>
/welcome set-buttons label1:<text> url1:<http(s)> label2:<text> url2:<http(s)>
/welcome set-color [color:#RRGGBB] [clear:true]
/welcome set-banner [url:<http(s)>] [clear:true]
/welcome set-dm enabled:<true|false> [template]
/welcome set-role [role] [clear:true]
/welcome test
/welcome show
/welcome set-anti-raid enabled:<true|false> [threshold:2..50]
/welcome set-goodbye enabled:<true|false> [channel]
/welcome set-goodbye-message [title] [message] [color]
/welcome set-stats [channel:<voice>] [format:<text>] [clear:true]
/welcome set-log-channel [channel:<text>] [clear:true]
```

`set-stats` supports `{total}` and `{online}`. `{online}` requires the Discord Presence Intent.
