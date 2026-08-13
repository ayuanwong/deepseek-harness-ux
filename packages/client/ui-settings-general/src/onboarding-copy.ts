/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-11.1'

/** The complete editable welcome notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '内测声明',
    paragraphs: [
      '感谢您愿意拨冗试用 DeepSeek Harness。当前版本仍处于内部测试阶段，功能仍待完善，体验难免有些粗糙。',
      '“如切如磋，如琢如磨。” 产品的成长，离不开一次次真实的碰撞与坦诚的反馈。您在真实使用中发现的问题，也可能促使我们重新审视，甚至推翻已有的设计。',
      '内测版本默认不会上传 Session Log。如需在提交反馈时共享会话日志，可以设置环境变量 DSH_TELEMETRY_MODE=FEEDBACK_ONLY；如需持续上传，可以设置 DSH_TELEMETRY_MODE=FULL，但该模式同时会启用 dsh-sdk 命令遥测，上报匿名 ID、命令结果以及脱敏后的项目配置。另外，如果您有任何反馈与建议，请在企业微信群中留言告诉我们。每一条反馈，都会帮助我们把它打磨得更好。',
    ],
    feedbackEmphasis: '如果您有任何反馈与建议，请在企业微信群中留言告诉我们',
    continueLabel: '继续',
  },
  en: {
    title: '内测声明',
    paragraphs: [
      '感谢您愿意拨冗试用 DeepSeek Harness。当前版本仍处于内部测试阶段，功能仍待完善，体验难免有些粗糙。',
      '“如切如磋，如琢如磨。” 产品的成长，离不开一次次真实的碰撞与坦诚的反馈。您在真实使用中发现的问题，也可能促使我们重新审视，甚至推翻已有的设计。',
      '内测版本默认不会上传 Session Log。如需在提交反馈时共享会话日志，可以设置环境变量 DSH_TELEMETRY_MODE=FEEDBACK_ONLY；如需持续上传，可以设置 DSH_TELEMETRY_MODE=FULL，但该模式同时会启用 dsh-sdk 命令遥测，上报匿名 ID、命令结果以及脱敏后的项目配置。另外，如果您有任何反馈与建议，请在企业微信群中留言告诉我们。每一条反馈，都会帮助我们把它打磨得更好。',
    ],
    feedbackEmphasis: '如果您有任何反馈与建议，请在企业微信群中留言告诉我们',
    continueLabel: '继续',
  },
} as const
