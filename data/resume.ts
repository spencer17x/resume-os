import type { Locale } from '@/i18n/routing'

export type ResumeData = {
  profile: {
    name: string
    englishName: string
    title: string
    location: string
    email: string
    github: string
    blog: string
    summary: string[]
    tags: string[]
  }
  skills: Array<{
    group: string
    items: string[]
  }>
  experiences: Array<{
    company: string
    role: string
    period: string
    tags: string[]
    bullets: string[]
  }>
  projects: Array<{
    id: string
    name: string
    type: string
    tags: string[]
    summary: string
    highlights: string[]
  }>
  openSource: string[]
}

// This dataset is intentionally fictional. It supports explicit demo mode and
// static sample routes without exposing a real person's career history.
export const resumeByLocale: Record<Locale, ResumeData> = {
  en: {
    profile: {
      name: 'Demo Candidate',
      englishName: 'Demo Candidate',
      title: 'AI Product / Agent Engineer',
      location: 'Remote',
      email: '',
      github: '',
      blog: '',
      summary: [
        'Fictional candidate profile for exploring Resume OS without loading personal information.',
        'Demonstrates evidence-grounded resume review, job matching, and agent-assisted drafting workflows.'
      ],
      tags: ['Demo Profile', 'AI Applications', 'Agent Workflows', 'Full-stack', 'Product Engineering']
    },
    skills: [
      {
        group: 'AI / Agent',
        items: ['Prompt Design', 'Structured Output', 'RAG', 'Tool Calling', 'Evaluation', 'Safety Boundaries']
      },
      {
        group: 'Frontend / Full-stack',
        items: ['TypeScript', 'React', 'Next.js', 'Node.js', 'API Design', 'State Management']
      },
      {
        group: 'Engineering',
        items: ['Testing', 'Performance', 'Accessibility', 'Observability', 'CI/CD']
      }
    ],
    experiences: [
      {
        company: 'Example AI Studio (Fictional)',
        role: 'AI Product Engineer',
        period: '2024 - Present',
        tags: ['Agent Workflow', 'Evaluation', 'Product Delivery'],
        bullets: [
          'Designed a review workflow that separates source evidence, model suggestions, and user-approved resume changes.',
          'Built structured AI outputs with validation, retry boundaries, and human approval checkpoints.',
          'Partnered with product and design to turn complex model behavior into understandable user controls.'
        ]
      },
      {
        company: 'Example Commerce Lab (Fictional)',
        role: 'Frontend Platform Engineer',
        period: '2022 - 2024',
        tags: ['Design Systems', 'Performance', 'Testing'],
        bullets: [
          'Created reusable interface foundations for data-heavy product workflows.',
          'Improved rendering paths and introduced regression tests for critical user journeys.',
          'Documented platform conventions and supported teams adopting shared components.'
        ]
      },
      {
        company: 'Example Cloud Team (Fictional)',
        role: 'Software Engineer',
        period: '2020 - 2022',
        tags: ['Web Applications', 'APIs', 'Automation'],
        bullets: [
          'Delivered web applications and API integrations for collaborative workflows.',
          'Automated repetitive release checks and improved error visibility for operators.',
          'Worked across frontend and backend boundaries to resolve production issues.'
        ]
      }
    ],
    projects: [
      {
        id: 'evidence-rag-lab',
        name: 'Evidence RAG Lab',
        type: 'Fictional Demo Project',
        tags: ['RAG', 'Retrieval', 'Citations', 'Evaluation'],
        summary: 'A fictional retrieval workspace that demonstrates grounded answers and source traceability.',
        highlights: [
          'Routes questions through retrieval, evidence ranking, and answer synthesis stages.',
          'Keeps source references attached to generated claims.',
          'Includes evaluation cases for missing and conflicting evidence.'
        ]
      },
      {
        id: 'story-media-sandbox',
        name: 'Story-to-Media Sandbox',
        type: 'Fictional Demo Project',
        tags: ['Structured Output', 'Workflow', 'Media'],
        summary: 'A fictional workflow that turns a short brief into reviewable scenes and media instructions.',
        highlights: [
          'Separates planning, generation, and verification into explicit stages.',
          'Uses schemas to keep downstream inputs predictable.',
          'Allows users to review each stage before continuing.'
        ]
      },
      {
        id: 'agent-qa-playground',
        name: 'Agent QA Playground',
        type: 'Fictional Demo Project',
        tags: ['Agent Evaluation', 'Testing', 'Safety'],
        summary: 'A fictional test bench for repeatable agent workflow checks.',
        highlights: [
          'Defines expected tool calls and output constraints for representative tasks.',
          'Captures failures as reusable regression cases.',
          'Surfaces unsupported claims for human review.'
        ]
      }
    ],
    openSource: [
      'Demo entry: documented a fictional TypeScript utility.',
      'Demo entry: added regression coverage to a fictional UI library.',
      'Demo entry: shared an example accessibility checklist.'
    ]
  },
  zh: {
    profile: {
      name: '演示候选人',
      englishName: 'Demo Candidate',
      title: 'AI 产品 / Agent 工程师',
      location: '远程',
      email: '',
      github: '',
      blog: '',
      summary: [
        '用于体验 Resume OS 的虚构候选人资料，不包含任何真实个人信息。',
        '展示基于证据的简历审阅、岗位匹配和 Agent 辅助改写流程。'
      ],
      tags: ['演示资料', 'AI 应用', 'Agent 工作流', '全栈工程', '产品工程']
    },
    skills: [
      {
        group: 'AI / Agent',
        items: ['提示词设计', '结构化输出', 'RAG', '工具调用', '效果评估', '安全边界']
      },
      {
        group: '前端 / 全栈',
        items: ['TypeScript', 'React', 'Next.js', 'Node.js', 'API 设计', '状态管理']
      },
      {
        group: '工程能力',
        items: ['自动化测试', '性能优化', '无障碍', '可观测性', 'CI/CD']
      }
    ],
    experiences: [
      {
        company: '示例 AI 工作室（虚构）',
        role: 'AI 产品工程师',
        period: '2024 - 至今',
        tags: ['Agent 工作流', '效果评估', '产品交付'],
        bullets: [
          '设计区分原始证据、模型建议和用户确认结果的简历审阅流程。',
          '通过结构化输出、校验机制和人工确认节点约束 AI 生成结果。',
          '与产品和设计协作，将复杂的模型行为转化为易理解的用户控制。'
        ]
      },
      {
        company: '示例商业实验室（虚构）',
        role: '前端平台工程师',
        period: '2022 - 2024',
        tags: ['设计系统', '性能优化', '自动化测试'],
        bullets: [
          '为数据密集型产品流程建设可复用的界面基础能力。',
          '优化渲染链路，并为关键用户路径补充回归测试。',
          '沉淀平台规范，支持不同团队复用共享组件。'
        ]
      },
      {
        company: '示例云团队（虚构）',
        role: '软件工程师',
        period: '2020 - 2022',
        tags: ['Web 应用', 'API', '自动化'],
        bullets: [
          '交付面向协作流程的 Web 应用和 API 集成。',
          '自动化重复的发布检查，并提升异常信息对运营人员的可见性。',
          '跨前后端边界协作处理产品问题。'
        ]
      }
    ],
    projects: [
      {
        id: 'evidence-rag-lab',
        name: '证据检索实验室',
        type: '虚构演示项目',
        tags: ['RAG', '检索', '引用', '评估'],
        summary: '用于展示基于证据回答和来源追踪能力的虚构检索工作台。',
        highlights: [
          '将问题处理拆分为检索、证据排序和答案合成阶段。',
          '让生成内容持续保留与来源证据的关联。',
          '覆盖证据缺失和证据冲突等评估场景。'
        ]
      },
      {
        id: 'story-media-sandbox',
        name: '故事媒体沙盒',
        type: '虚构演示项目',
        tags: ['结构化输出', '工作流', '媒体'],
        summary: '将简短需求转化为可逐步审阅的场景和媒体指令的虚构工作流。',
        highlights: [
          '将规划、生成和验证拆分为明确阶段。',
          '使用数据结构约束下游输入。',
          '允许用户在每个阶段确认后再继续。'
        ]
      },
      {
        id: 'agent-qa-playground',
        name: 'Agent 质量演练场',
        type: '虚构演示项目',
        tags: ['Agent 评估', '自动化测试', '安全'],
        summary: '用于执行可重复 Agent 工作流检查的虚构测试平台。',
        highlights: [
          '为代表性任务定义预期工具调用和输出约束。',
          '将失败场景沉淀为可复用的回归用例。',
          '标记缺少证据的声明，交由用户复核。'
        ]
      }
    ],
    openSource: [
      '演示条目：为虚构的 TypeScript 工具补充文档。',
      '演示条目：为虚构的 UI 组件库增加回归测试。',
      '演示条目：整理示例无障碍检查清单。'
    ]
  }
}

export function getResumeData(locale: Locale = 'zh') {
  return resumeByLocale[locale]
}

export const profile = resumeByLocale.zh.profile
export const skills = resumeByLocale.zh.skills
export const experiences = resumeByLocale.zh.experiences
export const projects = resumeByLocale.zh.projects
export const openSource = resumeByLocale.zh.openSource
