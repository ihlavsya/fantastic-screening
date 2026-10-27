import type { Config, Secrets } from "./config.ts";
import { checkIsInsideQuietHours } from "./quiet-hours.ts";

export type Telegram = {
  send: (html: string) => Promise<void>;
};

type OutgoingMessage = {
  html: string;
  isSilent: boolean;
};

export function createTelegram({ settings, secrets }: Config): Telegram {
  return {
    send: (html) =>
      postMessage(secrets, {
        html,
        isSilent: checkIsInsideQuietHours(new Date(), settings.quietHours),
      }),
  };
}

async function postMessage(secrets: Secrets, message: OutgoingMessage): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${secrets.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: secrets.telegramChatId,
      text: message.html,
      parse_mode: "HTML",
      disable_notification: message.isSilent,
      link_preview_options: { is_disabled: true },
    }),
  });
  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${String(response.status)} ${await response.text()}`);
  }
}
