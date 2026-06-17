const DRAFTS_KEY = 'trainingDrafts'
const SUBMISSIONS_KEY = 'trainingSubmissions'
const STORAGE_KEY = SUBMISSIONS_KEY
const EXTRA_DRAFTS_KEY = 'extraTrainingDrafts'
const EXTRA_SUBMISSIONS_KEY = 'extraTrainingSubmissions'

const MODULE_THEME = {
  reading: {
    gradient: 'linear-gradient(135deg, #4FB99F 0%, #6BC7B2 100%)',
    className: 'module-reading',
    iconType: 'book'
  },
  retell: {
    gradient: 'linear-gradient(135deg, #6D7FD6 0%, #8A80E8 100%)',
    className: 'module-retell',
    iconType: 'loop'
  },
  topic: {
    gradient: 'linear-gradient(135deg, #E98D7A 0%, #F2A28E 100%)',
    className: 'module-topic',
    iconType: 'bubble'
  },
  mandarin: {
    gradient: 'linear-gradient(135deg, #5C9FD6 0%, #78A7E3 100%)',
    className: 'module-mandarin',
    iconType: 'mic'
  }
}

function estimateChars(text) {
  return String(text || '').replace(/\s/g, '').length
}

function ensureLength(text, minChars, additions) {
  const result = [text]
  let index = 0
  const fallbackAdditions = [
    '练习时可以先整体读一遍，再把关键词、停顿和句尾单独标出来，最后用更自然的状态重新完成一次。',
    '如果内容较长，不要急着一次说完，可以在意思完整的位置换气，让声音、节奏和思路保持稳定。',
    '完成后请回听自己的录音，重点判断是否说清了主题、重点是否突出、结尾是否有明确收束。',
    '这段材料适合多练两遍，第一遍求准确，第二遍求自然，第三遍尝试加入更清楚的情绪和态度。'
  ]

  while (estimateChars(result.join('')) < minChars && index < additions.length + fallbackAdditions.length) {
    result.push(index < additions.length ? additions[index] : fallbackAdditions[index - additions.length])
    index += 1
  }

  return result.join('')
}

function buildDay(day, title, goal, requirement, material, tips, targetSeconds) {
  return {
    day,
    title,
    goal,
    requirement,
    material,
    tips,
    duration: `${targetSeconds}秒`,
    targetSeconds,
    estimatedChars: estimateChars(material)
  }
}

function getReadingTiming(day) {
  if (day <= 7) return { targetSeconds: 60, minChars: 190 }
  if (day <= 14) return { targetSeconds: 90, minChars: 285 }
  if (day <= 18) return { targetSeconds: 90, minChars: 365 }
  return { targetSeconds: 120, minChars: 410 }
}

function getRetellTiming(day) {
  if (day <= 7) return { targetSeconds: 60, minChars: 190 }
  if (day <= 14) return { targetSeconds: 90, minChars: 280 }
  if (day <= 18) return { targetSeconds: 90, minChars: 330 }
  return { targetSeconds: 120, minChars: 380 }
}

function getTopicTiming(day) {
  if (day <= 11) return { targetSeconds: 60, minChars: 165 }
  if (day <= 19) return { targetSeconds: 90, minChars: 230 }
  return { targetSeconds: 180, minChars: 320 }
}

function getMandarinTiming(day) {
  if (day <= 11) return { targetSeconds: 60, minChars: 130 }
  if (day <= 16) return { targetSeconds: 90, minChars: 190 }
  return { targetSeconds: 120, minChars: 220 }
}

function commonReadingTips(keyword) {
  return [
    `第一遍先慢读，找到“${keyword}”相关的关键词。`,
    '第二遍打开声音，逗号轻停，句号稳稳收住。',
    '录完后回听一次，只记录一个最明显的优点和一个改进点。'
  ]
}

function commonRetellTips(keyword) {
  return [
    `先圈出材料里和“${keyword}”有关的三个关键词。`,
    '复述时不要背原句，用自己的话讲清楚重点。',
    '结尾用一句话总结原因、结果或你的理解。'
  ]
}

function commonTopicTips(keyword) {
  return [
    '第一句直接表明观点，不要绕太久。',
    `中间围绕“${keyword}”补充原因和例子。`,
    '结尾用一句简短总结把观点收回来。'
  ]
}

function commonMandarinTips(keyword) {
  return [
    `先慢读“${keyword}”相关字词，确认口型和发音位置。`,
    '第二遍读短句，保持每个音节清楚完整。',
    '最后录一遍并回听，标记最容易含糊的两个音。'
  ]
}

const readingPlans = [
  { title: '基础短文朗读', keyword: '开口习惯', goal: '建立开口习惯，练声音清楚和语速稳定', tone: '自然、稳定', scene: '表达训练的第一步，是让自己愿意开口。刚开始不必追求完美，只要能把一段话清楚、完整、稳定地读完，就是一次有效练习。', point: '每天一分钟，看似很短，却能让嘴巴、大脑和声音慢慢熟悉表达状态。', ending: '今天请把声音放出来，读得清楚一点，慢一点，也坚定一点。' },
  { title: '慢速朗读训练', keyword: '慢速清楚', goal: '控制语速，避免越读越快', tone: '从容、清晰', scene: '说话不是越快越好，朗读也不是一口气冲到结尾。真正让人愿意听下去的声音，往往有稳定的节奏和清楚的停顿。', point: '慢下来，可以让字音更饱满，让句子更有层次，也让自己有时间换气和思考。', ending: '今天请用比平时慢一点的速度读完材料，感受稳和清楚带来的力量。' },
  { title: '洪亮声音训练', keyword: '声音打开', goal: '打开声音，让表达更有精神', tone: '明亮、有精神', scene: '一个有精神的声音，会先把自己的状态带起来。声音洪亮不是喊，而是站稳、放松肩膀、让气息支撑声音往前走。', point: '当声音不再缩在喉咙里，表达就会更清楚，也更容易让听众感到你在认真交流。', ending: '今天请把每个句子的开头读清楚，句尾不要飘走，让声音保持明亮。' },
  { title: '停顿训练', keyword: '停顿节奏', goal: '学会在合适位置停顿，让表达更有节奏', tone: '稳重、有层次', scene: '好的朗读不是一直说，而是知道在哪里停。停顿给听众理解的时间，也给自己换气和整理情绪的空间。', point: '逗号处轻轻停一下，句号处完整停一下，重要观点前后可以稍微多留半拍。', ending: '今天请把停顿当作表达的一部分，让每句话有开始、有展开，也有清楚的收束。' },
  { title: '重音训练', keyword: '关键词重音', goal: '找到句子里的关键词，让重点更突出', tone: '明确、有重点', scene: '一段话里不需要每个字都用力，真正需要被听见的是关键词。关键词像路标，能帮助听众快速抓住意思。', point: '例如“敢开口”“说清楚”“有逻辑”“更自信”，读到这些词时，可以稍微放慢、加重，但不要生硬。', ending: '今天请先默读一遍，找出每句话最重要的词，再用声音把它们送出来。' },
  { title: '语速控制', keyword: '语速变化', goal: '练习慢、中、稍快三种语速的切换', tone: '灵活、稳定', scene: '语速是一种表达工具。说明重点时可以慢一点，讲述过程时可以自然一点，表达情绪时可以稍微加快，但不能失去清楚。', point: '很多人一紧张就越说越快，越快越容易吞字，听众也更难跟上。', ending: '今天请把材料分成三段，第一段慢读，第二段正常读，第三段保持清楚地稍微提速。' },
  { title: '温暖语气朗读', keyword: '温暖语气', goal: '练习亲和、自然、有温度的表达', tone: '真诚、亲和', scene: '表达不只是传递信息，也是在传递态度。温暖的声音会让交流变轻松，真诚的语气会让别人更愿意靠近。', point: '当我们把声音放柔一点，把句尾收稳一点，话语就不容易显得急躁或生硬。', ending: '今天请带着微笑朗读，像在对一位朋友认真分享，而不是机械地念稿。' },
  { title: '坚定语气朗读', keyword: '坚定表达', goal: '练习有力量、有态度的朗读', tone: '坚定、沉稳', scene: '坚定不是大声压过别人，而是在表达自己的想法时不飘、不躲、不含糊。一个稳定的句尾，常常能让观点更有分量。', point: '当你读到“我愿意”“我可以”“我相信”这样的句子时，声音要向前，不要越读越轻。', ending: '今天请想象自己正在做一次小型发言，把每个关键句读得清楚、有底气。' },
  { title: '金句朗读', keyword: '短句感染力', goal: '练习短句的停顿、重音和感染力', tone: '凝练、有力量', scene: '真正有力量的话，往往不靠长，而靠准。短句需要更清楚的停顿，更准确的重音，也需要读出句子背后的态度。', point: '“敢开口，是改变表达的开始。”“说清楚，比说很多更重要。”“每一次回听，都是一次进步。”这些句子都适合慢下来读。', ending: '今天请每读完一句停一拍，让短句有空间，也让自己听见声音的变化。' },
  { title: '新闻播报感朗读', keyword: '客观清晰', goal: '练稳重、清晰、客观的表达', tone: '客观、稳重', scene: '今天的训练重点，是提升表达的清晰度和稳定性。训练过程中，学员需要关注语速、停顿、吐字和句尾完整度。', point: '通过持续练习，可以逐步改善声音发虚、表达含糊、节奏混乱等问题。播报式朗读不需要夸张情绪，但需要每个信息点都清楚。', ending: '请保持中等语速，像在向听众说明一件真实、重要但不需要渲染的事情。' },
  { title: '故事片段朗读', keyword: '故事画面', goal: '练画面感和自然表达', tone: '有画面、自然', scene: '那天，我站在教室门口，手里拿着准备好的稿子，心跳得很快。门里面传来同学们讨论的声音，我忽然有点想退缩。', point: '轮到我发言时，我深吸了一口气，告诉自己：先把第一句话说出来。没想到，当声音真正出来以后，紧张反而慢慢减轻了。', ending: '后来我才明白，很多改变不是等不紧张才开始，而是在紧张的时候仍然愿意开始。' },
  { title: '演讲开场朗读', keyword: '开场气场', goal: '练正式场合的开场稳定感', tone: '正式、清楚', scene: '各位老师、各位同学，大家好。今天我想和大家分享的主题是：如何通过表达训练改变自己的状态。', point: '很多人以为表达只是说话，其实表达也是一种自我建立的过程。当我们愿意把想法说清楚，就会更容易被理解，也更容易参与到真实交流中。', ending: '接下来，我会从开口习惯、声音状态和结构意识三个方面，谈谈表达训练带来的变化。' },
  { title: '长句气息训练', keyword: '长句换气', goal: '训练气息和长句控制', tone: '连贯、舒展', scene: '当我们开始重视表达训练的时候，就会发现，说话并不是简单地把字说出来，而是要让声音、气息、逻辑和情绪一起配合。', point: '如果没有气息支撑，长句很容易越读越急；如果没有语义停顿，听众也很难判断重点在哪里。', ending: '今天请在语义完整的位置换气，不要硬撑到没气，也不要把一句完整的话切得太碎。' },
  { title: '重点句重复训练', keyword: '重复强调', goal: '练习用重复突出重要观点', tone: '递进、明确', scene: '表达能力不是天生固定的。表达能力不是天生固定的。只要愿意持续练习，一个原本害怕开口的人，也可以慢慢变得清楚、稳定、有力量。', point: '重复不是机械地再说一遍，而是在第二遍里读出更明确的态度。第一次让听众听见，第二次让听众记住。', ending: '今天请把材料中的重点句读两遍，第二遍更慢、更稳，也更有力量。' },
  { title: '情绪递进朗读', keyword: '情绪递进', goal: '练习从平稳到有力量的情绪变化', tone: '层层推进', scene: '一开始，我只是想把话说完。后来，我希望自己能说清楚。再后来，我开始期待自己的表达能影响别人，让别人因为我的话多一点理解和行动。', point: '表达的成长常常是这样：从敢开口，到说完整，再到说得有重点，最后才慢慢形成自己的风格。', ending: '今天请把前半段读得平稳，后半段逐渐增加力量，让情绪自然递进。' },
  { title: '画面感朗读', keyword: '画面细节', goal: '练习让声音呈现具体画面', tone: '细腻、有画面', scene: '傍晚的训练室里，窗外的光慢慢暗下来。有人还在对着手机回听录音，有人在纸上圈出下一次要改的词。空气里没有热闹的掌声，只有一次又一次认真开口的声音。', point: '这样的练习看起来普通，却会在某个时刻帮上忙：一次汇报、一次面试、一次需要勇敢表达自己的对话。', ending: '今天请读出场景的变化，让听的人仿佛能看到画面。' },
  { title: '亲和力朗读', keyword: '亲和表达', goal: '练习真诚、轻松、不压迫的表达状态', tone: '轻松、温和', scene: '有些话，如果语气太硬，意思再好也容易被误解。有些建议，如果声音太急，对方还没听清就已经开始防备。', point: '亲和力不是讨好，而是让自己的表达更容易被接住。它来自清楚的态度、适度的停顿和愿意理解对方的语气。', ending: '今天请把声音放松一些，像在认真提醒，也像在真诚陪伴。' },
  { title: '节奏感朗读', keyword: '节奏变化', goal: '练习快慢、轻重和停顿的配合', tone: '有节奏、有弹性', scene: '一段好听的朗读，像一条有起伏的路。有的句子需要慢下来，让重点被听见；有的句子可以自然向前，让内容保持流动；有的地方需要停住，让情绪落地。', point: '如果所有句子都一样快、一样重，听众很快会疲惫。节奏的变化，会让表达更有生命力。', ending: '今天请标出三处需要停顿的地方，再标出三处需要强调的关键词。' },
  { title: '观点型短文朗读', keyword: '观点表达', goal: '练习读出观点和逻辑层次', tone: '清晰、有判断', scene: '我认为，表达训练真正重要的价值，不是让一个人变得会说漂亮话，而是让他能把真实想法说清楚。说清楚，意味着别人能理解你的目的、理由和期待。', point: '在学习、工作和生活里，很多误会并不是因为没有想法，而是因为想法没有被准确表达出来。', ending: '所以，练表达不是为了炫耀口才，而是为了让沟通更有效，让行动更一致。' },
  { title: '完整作品朗读', keyword: '完整呈现', goal: '完成一段较完整的朗读作品', tone: '完整、稳定', scene: '这二十天的练习，让我重新理解了表达。过去我总以为，表达好的人天生不紧张，声音也天然好听。后来我发现，稳定的声音、清楚的停顿、明确的重点，都可以在一次次练习中慢慢建立。', point: '有时候进步不明显，只是今天比昨天少卡了一次；有时候改变很具体，只是句尾不再发虚，观点不再绕远。', ending: '这些小变化累积起来，就会变成新的表达习惯。今天请把这段材料当作一次正式展示，完整读完，不急、不躲，也不轻易中断。' },
  { title: '朗读结营作品', keyword: '结营展示', goal: '综合运用声音、停顿、重音和情绪', tone: '自信、真诚', scene: '如果要用一句话总结这段训练，我想说：表达能力是可以被练出来的。它不是突然出现的天赋，而是每天愿意开口、愿意回听、愿意改进之后，慢慢长出来的能力。', point: '我也许还会紧张，也许还会读错，但我已经知道如何调整气息，如何放慢语速，如何把重点读清楚。更重要的是，我不再把一次不完美的表达看成失败。', ending: '今天的结营朗读，请用最稳定、最真诚的状态完成。把声音打开，把句子读清楚，也把这二十一天的坚持读出来。' }
]

const retellPlans = [
  { title: '三句话复述', keyword: '三句话', goal: '练习用三句话讲清一件事', scene: '昨天晚上，小林准备第二天的小组汇报。他先把四个人的资料放到一个文档里，又发现其中两部分内容重复。于是他重新调整顺序，把背景、问题和建议分成三页。汇报当天，他没有讲太多细节，而是先说明主题，再讲大家分工，最后提出改进方案。老师评价说，内容不算复杂，但重点比较清楚。' },
  { title: '关键词复述', keyword: '关键词', goal: '练习抓住材料里的核心词', scene: '一家社区图书角最近开始做“晚间共读”活动。组织者发现，很多上班族白天没有时间看书，但晚上愿意用半小时听别人分享。第一次活动只有八个人参加，大家围绕一本沟通类书籍交流了工作中的表达难题。活动结束后，有人建议下次提前发出三个讨论问题，这样交流会更聚焦。' },
  { title: '时间线复述', keyword: '时间线', goal: '按照先后顺序复述事件', scene: '周一，团队接到一个临时展示任务；周二，负责人把资料分给三位成员；周三晚上，大家发现数据口径不一致，只能重新核对；周四下午，展示稿终于定稿；周五正式汇报时，虽然准备时间紧，但因为每个人都清楚自己负责哪一段，最终展示比较顺利。' },
  { title: '因果复述', keyword: '因果', goal: '讲清原因、过程和结果', scene: '小陈以前在会议上很少发言，因为他总担心自己说得不够专业。后来主管让他每次会前先写三个关键词，只要求他补充一个观点。坚持几周后，他发现自己不再需要完整稿子，也能把想法说清楚。发言次数增加后，同事也更了解他的工作思路。' },
  { title: '故事复述', keyword: '故事重点', goal: '复述故事中的人物、冲突和转变', scene: '一位新同事第一次做客户介绍时非常紧张，开场几乎忘词。坐在旁边的前辈没有打断他，只是在纸上写下“先讲问题，再讲方案”递给他。新同事看见后稳定下来，重新把客户需求讲了一遍。后来他说，那张纸让他明白，表达紧张时最需要的不是完美台词，而是清楚顺序。' },
  { title: '生活经历复述', keyword: '经历结构', goal: '复述一次生活经历，讲清过程和感受', scene: '上周末，小雅参加了一次城市徒步。原本她只是想运动一下，没想到路上遇到一位退休老师，两个人聊起年轻时第一次公开发言的经历。老师说，很多人不是不会说，而是太怕被评价。小雅回家后把这句话记下来，也决定以后在课堂上多主动发言一次。' },
  { title: '新闻信息复述', keyword: '信息提炼', goal: '练习提炼新闻式信息的重点', scene: '某高校最近推出了“无手机自习区”。这个区域不强制没收手机，而是在入口提供自愿存放柜，并设置二十分钟专注计时。试运行一周后，参与学生反馈，自己更容易进入学习状态，也更愿意和同伴交流。学校表示，后续会根据使用情况增加座位。' },
  { title: '课堂知识复述', keyword: '知识转述', goal: '把课堂知识转成自己的话', scene: '今天的课堂讲到“有效沟通”的三个要素：目标清楚、对象明确、反馈及时。老师举例说，通知一件事时，如果只说“大家注意一下”，就容易让人不知道要做什么；如果说明时间、地点、任务和截止要求，沟通效率就会高很多。课后，有同学把这个方法用在小组协作里，发现误解明显减少。' },
  { title: '他人观点复述', keyword: '观点转述', goal: '准确复述别人的观点和理由', scene: '一位同学认为，表达能力不只是主持人或演讲者需要，普通学生和职场新人同样需要。他的理由有三点：第一，表达影响别人理解自己的效率；第二，清楚表达能减少合作中的误会；第三，敢于发言会带来更多机会。他最后补充，表达训练不一定要长时间，每天三分钟也有价值。' },
  { title: '视频内容复述', keyword: '内容整理', goal: '复述一段视频内容的主题和要点', scene: '一段训练视频讲了“上台前一分钟准备法”。第一步是站稳身体，做两次深呼吸；第二步是在心里默念开场第一句话；第三步是提醒自己只关注要传达的重点，而不是观众的表情。视频最后强调，紧张不能完全消失，但可以通过流程被管理。' },
  { title: '文章观点复述', keyword: '观点材料', goal: '复述一段观点材料并保留主旨', scene: '一篇短文提出，长期表达训练的核心不是背模板，而是建立三个习惯：第一，表达前先想清楚目的；第二，说话时尽量按顺序展开；第三，结束后回听或复盘一次。作者认为，模板只能帮助开头，真正的提升来自反复使用这些习惯。' },
  { title: '问题解决复述', keyword: '问题解决', goal: '复述问题、处理方式和结果', scene: '一个社团活动原计划在户外举办，活动前一小时突然下雨。负责人先确认室内教室是否可用，又让宣传同学通知已报名成员改地点，同时把原本的户外互动改成分组讨论。虽然流程临时调整，但因为信息传达及时，参与者没有明显混乱，活动也按时完成。' },
  { title: '对比式复述', keyword: '对比表达', goal: '练习复述两种做法的差异', scene: '同样是准备发言，有人习惯把整篇稿子背下来，有人只准备提纲和关键词。背稿的优点是内容完整，但一旦忘词容易卡住；提纲式准备更灵活，但需要对主题更熟悉。对大多数日常表达来说，先写结构，再记关键词，可能比逐字背诵更稳。' },
  { title: '加入感受的复述', keyword: '感受补充', goal: '在复述事件后加入真实感受', scene: '小李第一次在部门会上主动发言，只说了不到一分钟。内容很简单，是对一个流程的小建议。发言前他手心出汗，发言后也觉得自己说得不够流畅。但会议结束时，同事告诉他这个建议很实用。那一刻他意识到，表达不一定完美才有价值。' },
  { title: '加入启发的复述', keyword: '启发总结', goal: '复述后提炼一个可执行启发', scene: '一位学员连续七天录音，每天只练一段短文。最初他最在意读错了几个字，后来他开始关注语速、停顿和句尾力量。第七天回听第一天的录音，他发现进步不是突然变好，而是每次都比上次少一点犹豫。这个过程让他明白，复盘比单纯重复更重要。' },
  { title: '30秒复述', keyword: '压缩信息', goal: '用很短时间说清重点', scene: '公司内部分享会讨论了一个问题：新人如何更快融入团队。分享者认为，新人不一定要一开始就表现得很强，但要做到三件事：主动了解任务背景，及时反馈进度，遇到不懂的问题尽早确认。这样既能减少返工，也能让同事看到你的可靠。' },
  { title: '1分钟复述', keyword: '一分钟完整', goal: '完成一次结构完整的一分钟复述', scene: '一场校园讲座的主题是“如何建立长期习惯”。主讲人没有强调意志力，而是强调环境和反馈。他建议把目标拆得足够小，比如每天三分钟表达练习；再把完成记录可视化，让自己看到连续性；最后找一个可以反馈的人，帮助自己发现问题。' },
  { title: '复述后评价', keyword: '复述评价', goal: '从复述过渡到简短评价', scene: '某班级做了一次无稿发言训练。每位同学抽到一个话题后，准备一分钟，再发言一分钟。刚开始大家都很紧张，但几轮之后，教室气氛明显轻松。班长总结说，这个训练最大的价值不是让大家立刻说得很好，而是让每个人发现自己其实可以开口。' },
  { title: '复述后建议', keyword: '建议表达', goal: '复述问题后提出一个具体建议', scene: '一个学习小组总是在截止前才集中赶作业，导致讨论时间很少，最后展示也显得仓促。组员复盘后发现，问题不在能力，而在任务拆分太晚。有人建议下次一开始就确定时间表，每两天检查一次进度，最后一天只做修改和排练。' },
  { title: '综合复述', keyword: '综合结构', goal: '综合运用时间线、重点和感受', scene: '过去三周，小周参加了表达训练营。第一周他主要练朗读，解决声音小和语速快的问题；第二周练复述，学会用关键词抓重点；第三周练话题表达，尝试把观点、原因和例子连起来。虽然他还会紧张，但已经能在小组里主动做总结。' },
  { title: '复述结营作品', keyword: '结营复述', goal: '完成一次完整复述展示', scene: '请复述你最近学到的一项能力、参加的一次活动或看过的一段内容。材料可以来自课堂、工作、视频或真实经历。复述时先说明对象是什么，再讲三个重点：它主要讲了什么，哪些内容最有价值，它给你带来了什么启发。最后用一句话总结你接下来准备怎么做。' }
]

const topicPlans = [
  { title: '一分钟自我介绍', keyword: '自我介绍', goal: '练习自我展示和结构化表达', topic: '请用一分钟介绍你自己。', scene: '你正在参加一次新班级、新团队或训练营的破冰介绍，大家对你还不了解。', direction: '可以按照“我是谁、我的一个特点、一个小例子、希望别人记住我什么”来组织。' },
  { title: '我的一个优点', keyword: '优点表达', goal: '练习具体说出自己的优势', topic: '请介绍你身上的一个优点。', scene: '你需要在面试、课堂展示或自我复盘中，让别人更快理解你的优势。', direction: '不要只说“认真”或“负责”，要补充一个能证明优点的小经历。' },
  { title: '我想提升的一项能力', keyword: '目标表达', goal: '练习说清目标和行动计划', topic: '你现在最想提升的一项能力是什么？', scene: '你正在做阶段复盘，需要向老师、同伴或自己说明接下来的训练方向。', direction: '先说能力名称，再说为什么重要，最后说一个你准备立刻开始的小行动。' },
  { title: '如何看待上台紧张', keyword: '紧张应对', goal: '练习真实表达和原因分析', topic: '上台紧张是不是一件坏事？', scene: '身边有人因为紧张不敢发言，你需要说出自己的看法并给出鼓励。', direction: '可以承认紧张很正常，再说明紧张背后的原因，最后提出一个应对方法。' },
  { title: '自信是天生还是练出来的', keyword: '自信来源', goal: '练习判断表达和理由支撑', topic: '你认为自信是天生的，还是练出来的？', scene: '一次讨论中，有人认为性格内向的人很难变自信，你需要表达自己的观点。', direction: '建议先明确立场，再用经历或观察说明，自信如何通过行动慢慢建立。' },
  { title: '大学生是否应该主动争取机会', keyword: '主动机会', goal: '练习表达明确观点', topic: '大学生是否应该主动争取机会？', scene: '班级正在讨论实习、竞赛、社团和课堂展示机会，有人觉得顺其自然就好。', direction: '用“观点、原因、例子、总结”的结构，说清主动争取机会的价值和分寸。' },
  { title: '如何看待拖延', keyword: '拖延分析', goal: '练习现象、原因和建议表达', topic: '为什么很多人明知道要做，却还是拖延？', scene: '你和同学正在复盘一个延期完成的任务，需要分析拖延背后的原因。', direction: '可以从目标太大、害怕失败、缺少反馈三个角度选择一个展开。' },
  { title: '是否应该参加社团', keyword: '利弊分析', goal: '练习从两面看问题', topic: '大学生是否应该积极参加社团？', scene: '新生入学后面对很多社团邀请，有人担心占用时间，有人期待认识朋友。', direction: '先给出建议，再讲好处和风险，最后说明如何做选择更合适。' },
  { title: '如何主动认识老师', keyword: '主动沟通', goal: '练习校园沟通场景表达', topic: '大学生是否应该主动认识老师？', scene: '你想向老师请教问题，但担心打扰对方，也不知道如何开口。', direction: '可以从尊重、明确问题、表达感谢三个角度，说清主动沟通的方式。' },
  { title: '朋友重要还是能力重要', keyword: '比较表达', goal: '练习比较两个价值', topic: '对一个人的成长来说，朋友重要还是能力重要？', scene: '一次主题讨论中，大家对“关系”和“能力”的作用有不同看法。', direction: '请先选一个更重要的方向，再承认另一方也有价值，避免观点摇摆。' },
  { title: '沟通最重要的是什么', keyword: '沟通关键', goal: '练习价值表达', topic: '你认为沟通中最重要的是什么？', scene: '团队合作出现误会，有人觉得是态度问题，有人觉得是信息没讲清。', direction: '请选择一个关键词，比如真诚、倾听、清楚、反馈，并用例子说明。' },
  { title: '如何面对失败', keyword: '失败复盘', goal: '练习积极表达和方法总结', topic: '失败之后，最重要的是什么？', scene: '你刚经历一次考试、比赛、汇报或面试失利，需要给自己或同伴做一次复盘。', direction: '不要只说鼓励话，可以讲失败原因、可改进点和下一步行动。' },
  { title: '推荐一本书或电影', keyword: '推荐表达', goal: '练习介绍和说服', topic: '请向别人推荐一本书、一部电影或一个节目。', scene: '朋友想利用周末看点有启发的内容，你需要做一个简短推荐。', direction: '先说作品名称，再说适合谁、亮点是什么，最后给出一句推荐理由。' },
  { title: '班委竞选发言', keyword: '竞选说服', goal: '练习正式场合下的说服表达', topic: '如果你要竞选班委，你会怎么说？', scene: '你站在班级同学面前，需要在一分半左右说明自己为什么适合这个角色。', direction: '可以讲个人优势、过往经历、能为大家做什么，并用自然语气发出请求。' },
  { title: '社团面试回答', keyword: '面试动机', goal: '练习临场回应和动机表达', topic: '你为什么想加入我们这个社团？', scene: '社团面试官希望了解你的兴趣、能力和投入时间，你需要回答得真诚具体。', direction: '先说兴趣来源，再讲你能贡献什么，最后表达愿意学习和参与。' },
  { title: '面试自我介绍', keyword: '正式介绍', goal: '练习面试中的清晰表达', topic: '请完成一次简短面试自我介绍。', scene: '你正在参加实习、社团或项目面试，面试官希望快速了解你的背景和优势。', direction: '按照“身份背景、能力亮点、相关经历、期待机会”的顺序表达。' },
  { title: '课堂发言', keyword: '课堂观点', goal: '练习课堂中的观点表达', topic: '表达能力对大学生重要吗？', scene: '老师在课堂上点名请你发表看法，你只有一分钟时间组织观点。', direction: '开头直接说“我认为重要/比较重要”，中间给两个理由，结尾回应学习和未来场景。' },
  { title: '即兴感谢', keyword: '感谢表达', goal: '练习具体、自然的情感表达', topic: '请做一次即兴感谢发言。', scene: '一次活动结束后，你需要感谢帮助过你的人，现场没有准备好的稿子。', direction: '说清感谢对象、具体帮助、你的感受和一句祝福或期待。' },
  { title: '即兴总结', keyword: '总结收束', goal: '练习活动后的总结表达', topic: '请对一次活动或训练做一分钟总结。', scene: '你代表小组做最后发言，需要把大家的经历和收获收束起来。', direction: '先总结整体感受，再讲一个最重要的收获，最后给一句鼓励或下一步建议。' },
  { title: '三分钟主题表达', keyword: '主题展开', goal: '练习较长时间的主题表达', topic: '请围绕“持续练习为什么重要”做三分钟表达。', scene: '你正在训练营结尾分享自己的理解，需要从个人经历、训练方法和未来行动三个层面展开。', direction: '建议结构：开场提出观点，第一部分讲过去的问题，第二部分讲训练带来的改变，第三部分讲接下来怎么坚持，最后用一句话收束主题。' },
  { title: '话题结营演讲', keyword: '结营演讲', goal: '完成一次完整主题演讲', topic: '请围绕“21天后，我的表达变化”做结营演讲。', scene: '这是一次面向同学、同事或训练伙伴的正式展示，你要讲出自己的变化，而不是简单报流水账。', direction: '可以按“训练前的状态、训练中的一个关键时刻、现在的具体变化、未来继续练什么”来组织，尽量讲真实例子。' }
]

const mandarinPlans = [
  { title: '声母清晰度', keyword: '声母', goal: '练习声母发音位置和吐字清楚', material: '字词：爸、怕、妈、发；得、特、呢、乐；哥、科、喝。短句：爸爸把包放到门边，妈妈慢慢发来消息；哥哥开口说话，语气清楚又自然。小段：今天练声母，要把每个字头咬住，声音不要含在嘴里。' },
  { title: '单音节字训练', keyword: '单音节', goal: '练习单字读准和四声稳定', material: '单字：山、明、海、路、风、雨、桥、远、近、暖、冷、稳、准、清、亮、慢、快、停、重、轻。短句：读单字时不要急，每个音节都要有头有尾。小段：单音节训练看起来简单，却能暴露吐字是否含糊、声调是否到位。' },
  { title: '双音节词训练', keyword: '双音节', goal: '练习词语连读和重音自然', material: '词语：表达、训练、清楚、稳定、自然、逻辑、机会、准备、声音、节奏、态度、反馈、总结、进步。短句：表达训练需要稳定节奏，也需要及时反馈。小段：读双音节词时，注意不要把两个字拆得太碎，也不要连得含糊。' },
  { title: '四声变化', keyword: '四声', goal: '练习阴平、阳平、上声、去声的变化', material: '字组：妈、麻、马、骂；衣、移、椅、意；书、熟、鼠、树。短句：声调一变，意思就会变化；声调稳定，普通话才更清楚。小段：今天请把四个声调读完整，上声不要塌下去，去声要干脆落下。' },
  { title: '平翘舌', keyword: '平翘舌', goal: '区分 z、c、s 与 zh、ch、sh', material: '字词：早晨、知识、城市、支持、思索、产生、真实、措施。短句：四是四，十是十，十四不是四十。小段：练平翘舌时，平舌音舌尖靠近上齿背，翘舌音舌尖轻轻翘起，不要把两类音混在一起。' },
  { title: '前后鼻音', keyword: '前后鼻音', goal: '区分 an、en、in 与 ang、eng、ing', material: '字词：认真、安静、心情、方向、成长、声音、平衡、清醒。短句：清晨的风很轻，远方的钟声很长。小段：前鼻音收得轻一些，后鼻音口腔打开一些。读的时候先慢后快，听清自己有没有把音拖混。' },
  { title: 'n 和 l', keyword: 'n/l', goal: '练习 n 与 l 的发音差异', material: '字词：努力、能力、年龄、哪里、理论、练习、冷暖、留念。短句：奶奶拿来蓝色篮子，里面放着新鲜莲藕。小段：n 音舌尖抵住上齿龈并带鼻音，l 音舌尖位置相近但气流从舌侧出来。' },
  { title: 'f 和 h', keyword: 'f/h', goal: '区分唇齿音和舌根音', material: '字词：方法、发挥、丰富、恢复、欢呼、黄昏、河风、花费。短句：黄昏后，海风缓缓吹过湖边。小段：f 发音时上齿轻触下唇，h 发音时口腔后部送气，不要把“方法”读成“黄法”。' },
  { title: '轻声', keyword: '轻声', goal: '练习轻声词的自然读法', material: '词语：妈妈、朋友、东西、明白、喜欢、漂亮、时候、地方、孩子、我们。短句：朋友来了以后，我们把东西放在桌子上。小段：轻声不是随便读轻，而是让第二个音节自然变短、变轻，语流听起来更像日常普通话。' },
  { title: '儿化', keyword: '儿化', goal: '练习儿化音的自然卷舌', material: '词语：花儿、门儿、这会儿、一点儿、慢点儿、好玩儿、聊天儿。短句：下班后，我们在院儿里聊了一会儿。小段：儿化要自然，不要把“儿”字读得太重。可以先慢读，再把前一个音和儿化动作连起来。' },
  { title: '易错字词', keyword: '易错字词', goal: '练习常见易混读音和清楚吐字', material: '词语：角色、处理、质量、氛围、潜力、比较、因为、即使、仍然、尽量。短句：良好的氛围能帮助大家更自然地表达。小段：易错字词不必一次追求全部掌握，今天先选三个最容易读错的词，慢读、标记、再录音回听。' },
  { title: '慢速绕口令', keyword: '慢速绕口令', goal: '先准确再提速，保证发音清晰', material: '绕口令：四是四，十是十，十四是十四，四十是四十。短句：山上三棵松，松下三声钟。练习段：第一遍请慢读，重点听平翘舌；第二遍正常速度读，保持每个字清楚；第三遍稍微加快，但不要牺牲准确。' },
  { title: '节奏绕口令', keyword: '节奏绕口令', goal: '练习节奏、气息和平稳提速', material: '绕口令：白石塔，白石搭，白石搭白塔，白塔白石搭。补充句：北边奔来一队标兵，标兵步子稳，声音也稳。练习段：先把句子分成小节，每节之间轻停半拍；熟悉以后再连起来读，保持气息不断。' },
  { title: '短句朗读', keyword: '短句清晰', goal: '练习日常短句里的吐字和停顿', material: '短句：表达要清楚，态度要自然。声音要稳定，句尾要收住。沟通不是抢话，而是把话接住、说清、送回去。练习段：今天请把每个短句读成完整意思，不要把句尾吞掉，也不要因为句子短就读得太快。' },
  { title: '短文朗读', keyword: '短文普通话', goal: '在短文中综合练习声调、停顿和吐字', material: '短文：清晨，我走在上班路上，听见路边有人练习朗读。声音不大，却很清楚；语速不快，却有节奏。我忽然想到，普通话训练不是为了说得夸张，而是为了让每一句话都更准确、更自然。今天的练习，就从把一段短文读稳开始。' },
  { title: '语调自然', keyword: '自然语调', goal: '练习不生硬、不拖腔的普通话表达', material: '材料：普通话说得好，不只是字音标准，也包括语调自然。日常表达里，如果每句话都像背书，听起来会不亲切；如果语调太随意，重点又容易丢失。请用自然语气读这段话，开头稳一点，中间有起伏，结尾清楚收住。' },
  { title: '命题说话：我的一天', keyword: '命题说话', goal: '练习普通话命题表达的清楚和连贯', material: '题目：我的一天。提示：可以从早晨、白天、晚上三个时间段展开。不要只报流水账，选择一个最有代表性的细节，比如一次通勤、一次学习、一次交流或一次复盘。请注意普通话发音清楚，语速不要太快。' },
  { title: '命题说话：我的朋友', keyword: '人物表达', goal: '练习人物介绍中的发音和结构', material: '题目：我的朋友。提示：先介绍这个朋友是谁，再说一个让你印象深刻的特点，最后讲一件能体现这个特点的小事。表达时注意 n/l、平翘舌和前后鼻音，人物名字或关键词要读得格外清楚。' },
  { title: '命题说话：一次难忘的经历', keyword: '经历表达', goal: '练习叙事普通话和情绪自然度', material: '题目：一次难忘的经历。提示：按照“时间地点、发生了什么、我当时怎么想、最后有什么收获”的顺序讲。不要急着把所有细节都说完，重点放在一两个画面上。请保持普通话清楚，情绪真实但不过度夸张。' },
  { title: '命题说话：我喜欢的一本书', keyword: '推荐普通话', goal: '练习介绍类命题说话', material: '题目：我喜欢的一本书。提示：可以介绍书名、你为什么读它、它带给你什么启发，以及你会推荐给什么样的人。表达时注意书名和关键词要读准，句子之间要有停顿，不要像背材料一样一口气说完。' },
  { title: '普通话结营作品', keyword: '综合普通话', goal: '综合练习发音、声调、停顿和自然表达', material: '题目：普通话训练带给我的变化。提示：先说训练前最明显的问题，比如平翘舌、前后鼻音、语速或吐字；再说训练中最有帮助的方法；最后说你准备如何继续练习。请把这次作品当作正式展示，发音清楚，语调自然，结尾有收束。' }
]

function createReadingDays() {
  return readingPlans.map((plan, index) => {
    const day = index + 1
    const timing = getReadingTiming(day)
    const material = ensureLength(`${plan.scene}${plan.point}${plan.ending}`, timing.minChars, [
      `朗读时请保持${plan.tone}的状态，让句子之间有呼吸，也让关键词自然突出。`,
      '如果读到后半段感觉气息变弱，可以在语义完整的位置换气，再继续向前读。',
      '这段材料适合录下来回听，重点观察声音是否稳定、句尾是否完整、情绪是否自然。'
    ])

    const dayItem = buildDay(
      day,
      plan.title,
      plan.goal,
      `请朗读下面这段原创材料，重点练习${plan.keyword}，要求声音清楚、停顿自然、句尾完整。`,
      material,
      commonReadingTips(plan.keyword),
      timing.targetSeconds
    )

    if (day === 1) {
      dayItem.contentTitle = '白杨礼赞主题朗读'
    }

    return dayItem
  })
}

function createRetellDays() {
  return retellPlans.map((plan, index) => {
    const day = index + 1
    const timing = getRetellTiming(day)
    const material = ensureLength(plan.scene, timing.minChars, [
      `请先读完材料，再合上页面，用自己的话复述，不要逐字背诵。`,
      `复述时围绕“${plan.keyword}”展开，尽量讲清背景、过程、重点和结果。`,
      '如果时间允许，可以在最后补充一句自己的理解或评价，让复述更完整。'
    ])

    return buildDay(
      day,
      plan.title,
      plan.goal,
      `请阅读材料后完成复述，重点练习${plan.keyword}，要求有开头、有重点、有结尾。`,
      material,
      commonRetellTips(plan.keyword),
      timing.targetSeconds
    )
  })
}

function createTopicDays() {
  return topicPlans.map((plan, index) => {
    const day = index + 1
    const timing = getTopicTiming(day)
    const material = ensureLength(`话题：${plan.topic}情境：${plan.scene}思考方向：${plan.direction}`, timing.minChars, [
      `表达结构建议：先说观点，再说原因，然后给一个真实例子，最后用一句话总结。`,
      `如果一时想不到内容，可以先围绕“${plan.keyword}”说一个自己的经历或身边观察。`,
      '注意控制时间，不要只说一句结论，也不要把所有细节铺得太散。'
    ])

    return buildDay(
      day,
      plan.title,
      plan.goal,
      `请围绕话题完成即兴表达，重点练习${plan.keyword}，建议使用“观点 + 原因 + 例子 + 总结”的结构。`,
      material,
      commonTopicTips(plan.keyword),
      timing.targetSeconds
    )
  })
}

function createMandarinDays() {
  return mandarinPlans.map((plan, index) => {
    const day = index + 1
    const timing = getMandarinTiming(day)
    const material = ensureLength(plan.material, timing.minChars, [
      `请围绕“${plan.keyword}”慢读两遍，再用自然语速读一遍。`,
      '练习时保持口腔打开，遇到容易混淆的音节先单独读，再放回句子里读。',
      '录音回听时，不评价好不好听，只判断发音是否清楚、声调是否稳定。'
    ])

    return buildDay(
      day,
      plan.title,
      plan.goal,
      `请按材料完成普通话练习，重点关注${plan.keyword}，先求准确，再逐步提高速度。`,
      material,
      commonMandarinTips(plan.keyword),
      timing.targetSeconds
    )
  })
}

const trainingModules = [
  {
    id: 'reading',
    title: '21天朗读训练',
    shortTitle: '朗读训练',
    desc: '训练语感，积累好词好句，让表达更流畅、更自信',
    icon: 'book',
    color: MODULE_THEME.reading.gradient,
    gradient: MODULE_THEME.reading.gradient,
    themeColor: MODULE_THEME.reading.gradient,
    className: MODULE_THEME.reading.className,
    iconType: MODULE_THEME.reading.iconType,
    days: createReadingDays()
  },
  {
    id: 'retell',
    title: '21天复述训练',
    shortTitle: '复述训练',
    desc: '练概括能力、重点提炼和语言组织力',
    icon: 'loop',
    color: MODULE_THEME.retell.gradient,
    gradient: MODULE_THEME.retell.gradient,
    themeColor: MODULE_THEME.retell.gradient,
    className: MODULE_THEME.retell.className,
    iconType: MODULE_THEME.retell.iconType,
    days: createRetellDays()
  },
  {
    id: 'topic',
    title: '21天话题训练',
    shortTitle: '话题训练',
    desc: '练即兴表达、观点表达和逻辑结构',
    icon: 'bubble',
    color: MODULE_THEME.topic.gradient,
    gradient: MODULE_THEME.topic.gradient,
    themeColor: MODULE_THEME.topic.gradient,
    className: MODULE_THEME.topic.className,
    iconType: MODULE_THEME.topic.iconType,
    days: createTopicDays()
  },
  {
    id: 'mandarin',
    title: '21天普通话训练',
    shortTitle: '普通话训练',
    desc: '练发音、声调、平翘舌和前后鼻音',
    icon: 'mic',
    color: MODULE_THEME.mandarin.gradient,
    gradient: MODULE_THEME.mandarin.gradient,
    themeColor: MODULE_THEME.mandarin.gradient,
    className: MODULE_THEME.mandarin.className,
    iconType: MODULE_THEME.mandarin.iconType,
    days: createMandarinDays()
  }
]

const extraTraining = [
  {
    id: 'dailyQuote',
    title: '每日金句',
    desc: '随机一句金句，练朗读和表达感',
    icon: '❝',
    color: 'yellow',
    className: 'extra-dailyQuote',
    iconClass: 'extra-icon-quote',
    items: [
      { text: '把话说清楚，是尊重别人，也是整理自己。', category: '表达习惯', source: 'system', usageTip: '重读“清楚”和“整理”。' },
      { text: '敢开口，不是没有紧张，而是紧张时依然愿意开始。', category: '表达自信', source: 'system', usageTip: '前半句慢一点，后半句读坚定。' },
      { text: '真正有效的沟通，是让对方听懂，也让自己说准。', category: '沟通表达', source: 'system', usageTip: '“听懂”和“说准”之间停顿。' },
      { text: '表达不是表演自己，而是把重要的意思准确送达。', category: '表达理念', source: 'system', usageTip: '语气稳，不要读得太飘。' },
      { text: '每一次回听，都是下一次表达变好的起点。', category: '训练复盘', source: 'system', usageTip: '读出鼓励感。' },
      { text: '有结构的表达，会让复杂的想法变得容易理解。', category: '逻辑结构', source: 'system', usageTip: '重读“结构”和“理解”。' },
      { text: '声音稳一点，思路清一点，表达就会更有力量。', category: '声音状态', source: 'system', usageTip: '三个短句之间轻停。' },
      { text: '好的开场不一定华丽，但一定要清楚、自然、有方向。', category: '开场表达', source: 'system', usageTip: '三个关键词逐个读清楚。' },
      { text: '复述不是背诵，而是把重点变成自己的语言。', category: '复述训练', source: 'system', usageTip: '“不是”和“而是”形成对比。' },
      { text: '每天三分钟，也可以为表达建立稳定的肌肉记忆。', category: '训练坚持', source: 'system', usageTip: '句尾收稳，读出坚持感。' },
      { text: '说得自然，不等于随便；说得有力，也不等于用力。', category: '表达分寸', source: 'system', usageTip: '两组对比要读出层次。' },
      { text: '当你能总结自己，就更容易向别人说明自己。', category: '总结表达', source: 'system', usageTip: '“总结”和“说明”稍重。' }
    ],
    importedQuotes: []
  },
  {
    id: 'randomTopic',
    title: '随机话题',
    desc: '随机一个话题，完成 60 秒即兴表达',
    icon: '?',
    color: 'blue',
    className: 'extra-randomTopic',
    iconClass: 'extra-icon-topic',
    items: [
      '你认为大学生最应该培养什么能力？',
      '如何看待“内向的人也可以有表达力”？',
      '你最近一次克服紧张是什么时候？',
      '你觉得会说话的人有什么特点？',
      '如果让你竞选班委，你会怎么介绍自己？',
      '你认为朋友之间最重要的是什么？',
      '如何面对一次失败的上台经历？',
      '你最想改变自己的一个表达习惯是什么？',
      '你觉得普通话重要吗？为什么？',
      '你如何理解“表达是一种能力，也是一种习惯”？',
      '你更喜欢提前准备发言，还是即兴表达？',
      '你觉得声音洪亮重要，还是逻辑清楚重要？',
      '如果你要感谢一个帮助过你的人，你会怎么说？',
      '你认为年轻人为什么需要练习公众表达？',
      '你希望 21 天后自己的表达有什么变化？'
    ]
  },
  {
    id: 'tongueTwister',
    title: '绕口令挑战',
    desc: '练发音、气息、平翘舌和前后鼻音',
    icon: '~',
    color: 'orange',
    className: 'extra-tongueTwister',
    iconClass: 'extra-icon-twister',
    items: [
      '四是四，十是十，十四是十四，四十是四十。',
      '吃葡萄不吐葡萄皮，不吃葡萄倒吐葡萄皮。',
      '八百标兵奔北坡，炮兵并排北边跑。',
      '黑化肥发灰，灰化肥发黑。',
      '红鲤鱼与绿鲤鱼与驴。',
      '牛郎恋刘娘，刘娘念牛郎。',
      '粉红墙上画凤凰，凤凰画在粉红墙。',
      '山前有四十四棵死涩柿子树。',
      '白石塔，白石搭，白石搭白塔，白塔白石搭。',
      '哥挎瓜筐过宽沟，赶快过沟看怪狗。'
    ]
  }
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function getTrainingModules() {
  return clone(trainingModules)
}

function getExtraTraining() {
  return clone(extraTraining)
}

function getExtraTrainingById(extraType) {
  const target = extraTraining.find(item => item.id === extraType)
  return target ? clone(target) : null
}

function getModuleById(moduleId) {
  const target = trainingModules.find(item => item.id === moduleId)
  return target ? clone(target) : null
}

function getTaskByModuleAndDay(moduleId, day) {
  const target = trainingModules.find(item => item.id === moduleId)
  if (!target) return null

  const task = target.days.find(item => item.day === Number(day))
  return task ? clone(task) : null
}

module.exports = {
  STORAGE_KEY,
  DRAFTS_KEY,
  SUBMISSIONS_KEY,
  EXTRA_DRAFTS_KEY,
  EXTRA_SUBMISSIONS_KEY,
  trainingModules,
  extraTraining,
  getTrainingModules,
  getExtraTraining,
  getExtraTrainingById,
  getModuleById,
  getTaskByModuleAndDay
}
