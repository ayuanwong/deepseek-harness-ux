# @deepseek-ai/dsh-client-ui-settings-general

English | [中文](README.zh.md)

Settings shell, ownerless-copy, and product-onboarding plugin. It occupies `sidebar.settings` with the trigger chrome and modal settings panel, projects the `settings.section` ledger into the navigation and the `settings.onboarding` ledger into one mounted page at a time, and registers everything on the Settings pages that belongs to no single feature — the trigger/header/close chrome content, the local configuration-file action, the General section and its `settings.general.item` slot, the `settings` dictionaries, and the first ordered welcome step. The slot types it renders into belong to ui-settings, the settings domain base; only the shell's own contract types live here, because they reference ui-sidebar's slot type and the base layer must depend on no `ui-*` package. Feature-owned rows (Permission, Language, Appearance), sections (Models), and conditional onboarding steps stay with their feature packages.

The shell ships no copy of its own — all text arrives from registrants. Nav labels may be locale-following thunks, so the nav projection resolves them through `resolveSlotLabel` and re-renders on the section ledger bump or the locale revision (an optional `ctx.get('locale')` read; no hard locale dependency). The onboarding ledger projects in ascending order and mounts exactly one page at a time; the takeover chrome (body-level stage, mask, app-root `inert`) belongs to the step itself through ui-primitives' `OnboardingSurface`, so a mounted step still resolving its private facts renders null and neither paints nor blocks anything — the shell shows no empty stage while a step decides. The active registrant receives its id, `complete()`, and an `openSection(id)` callback; completing or skipping transfers ownership to the next entry. Registrants own durable completion, capability readiness, copy, mutations, and the surface wrap, so independently registered flows cannot stack and the shell does not become a second configuration fact source.

A loopback browser loads the provider's `hasDocument` capability through `settings.describe` and renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action sends the pathless, loopback-only `settings.openDocument` request; the Host resolves the provider path again, materializes an absent document, and hands it to a native text editor (`open -t` on macOS, bypassing a browser file association; the desktop file association on Linux and Windows; Windows association after `wslpath -w` translation on WSL). Open failures keep the action available and render a localized error. Reopening the dialog or reconnecting refreshes availability after a transient read failure or Host topology change. Remote browsers never register the action and never issue the privileged settings read.

`src/onboarding-copy.ts` is the single editable owner of the complete notice plus `WELCOME_NOTICE_VERSION`; both supported GUI locales intentionally render the same Chinese copy. The Host half registers `ui-onboarding` in the user-settings seam. A loopback browser compares `welcomeNoticeVersion` for exact equality and writes the current value only after Continue succeeds. The path mutation is idempotent across tabs and preserves sibling settings, while `host/settings-changed` makes an externally acknowledged notice advance without a reload. A non-loopback browser cannot access the privileged settings API: it still presents the notice, but Continue advances only the current browser process and a reload presents the notice again. A different version deliberately presents the notice again. The welcome page preserves every authored paragraph, gives the requested clause in the final paragraph the sole emphasis, initially focuses the title, and has no close, Escape, mask-click, or secondary path. None of its copy or acknowledgement enters a Session log or model request. The notice states that session telemetry is disabled by default, names the `FEEDBACK_ONLY` and `FULL` opt-in modes, and discloses that `FULL` also enables dsh-sdk command telemetry.

## Model Experience

None, as the plugin renders browser settings UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The General section has no built-in rows; each row appears only when its owning feature plugin is mounted.
