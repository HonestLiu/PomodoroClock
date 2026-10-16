// 简体中文词表（默认语言）。
// 约定：所有 UI 文案统一走 t()，便于双语维护。格式 {key: 文案}，`{x}` 为插值。
export const zh = {
  // 框架
  'app.title': 'FocusPomodoro',
  'search.placeholder': '搜索',
  'nav.today': '今天', 'nav.tomorrow': '明天', 'nav.week': '本周',
  'nav.scheduled': '已计划', 'nav.completed': '已完成', 'nav.tasks': '任务',
  'sidebar.createList': '创建清单',
  'list.placeholder': '清单名称，回车创建',
  'list.dropToMove': '移入',
  'account.upload': '上传头像',
  'title.premium': '高级版', 'title.friends': '好友 / 社区', 'title.achievements': '成就',

  // 统计卡
  'stat.estTime': '预计时间', 'stat.pending': '待完成任务',
  'stat.focused': '已专注时间', 'stat.completed': '已完成任务',
  'stat.totalFocus': '总专注时间', 'stat.weekFocus': '本周专注时间',
  'stat.todayFocus': '今日专注时间', 'stat.totalDone': '总完成任务',
  'stat.weekDone': '本周完成任务', 'stat.todayDone': '今日完成任务',

  // 任务
  'task.add': '在“{list}”中添加一个任务，按「回车」键保存',
  'task.showCompleted': '显示已完成任务',
  'task.empty': '暂无待完成任务',
  'task.complete': '标记为已完成', 'task.uncomplete': '标记为未完成',
  'task.edit': '编辑任务', 'task.moveToList': '移到清单', 'task.copy': '复制任务',
  'task.delete': '删除任务', 'task.noneList': '未指定清单',
  'task.deleteTitle': '删除任务',
  'task.deleteMsg': '确定要删除「{title}」吗？该任务关联的专注记录将变为「未指定任务」。',
  'task.estHint': '换算：预计时长 ÷ 25 分钟',
  'task.list': '清单', 'task.est': '预估番茄数', 'task.due': '到期日', 'task.notes': '备注',
  'task.name': '任务名称',
  'common.none': '未指定',

  // 计时
  'timer.phase.focus': '专注', 'timer.phase.break': '休息', 'timer.phase.idle': '准备开始',
  'timer.cta.start': '开始专注', 'timer.cta.pause': '暂停', 'timer.cta.resume': '继续专注',
  'timer.cta.startBreak': '开始休息',
  'timer.skip': '跳过', 'timer.fullscreen': '全屏', 'timer.noise': '白噪音',
  'timer.mode.pomodoro': '番茄钟', 'timer.mode.countdown': '倒计时', 'timer.mode.stopwatch': '正计时',
  'timer.todayFocus': '今日专注时间', 'timer.today': '今天', 'timer.todayRecords': '今日专注记录',
  'timer.remaining': '剩余', 'timer.elapsed': '已专注',
  'timer.thisRound': '本轮已完成 {n} 个番茄', 'timer.noTasks': '暂无待完成任务',
  'timer.feedback.focusDone': '番茄完成 ✓ 休息一下吧',
  'timer.feedback.breakDone': '休息结束 ✓ 开始下一轮专注',
  'timer.recover': '检测到上次会话：{detail}。倒计时状态已恢复，继续或重新开始。',
  'timer.recover.focus': '上一个专注已为你归档',
  'timer.recover.break': '上一段休息已结束',
  'timer.recover.continue': '继续下一阶段', 'timer.recover.ok': '知道了',
  'timer.untitled': '未指定任务',
  'float.focusing': '专注中', 'float.breaking': '休息中', 'float.todayCount': '今日番茄',

  // 报表
  'report.title': '报表', 'report.pomodoroGrid': '番茄记录', 'report.gridSub': '近 14 天 · 时间 × 日期',
  'report.trend': '专注趋势', 'report.trendSub': '近 30 天 · 与每日目标对比',
  'report.detail': '专注时间', 'report.distribution': '清单时间分布',
  'report.goal': '每日专注目标', 'report.target': '目标:{v}',
  'report.showTask': '显示任务', 'report.totalFocus': '总专注时间:{v}',
  'report.day': '日', 'report.week': '周', 'report.month': '月', 'report.year': '年',
  'report.today': '今天', 'report.thisWeek': '本周',
  'report.focusDays': '专注天数:{n}天', 'report.goalDays': '完成目标天数:{n}天',
  'report.goalRate': '目标完成率:{n}%',
  'report.sumNDays': '近 {n} 天合计 {m} 分钟', 'report.avg': '日均 {n} 分钟',
  'report.goalAchieve': '今日目标达成度', 'report.noneThisPeriod': '该周期暂无专注记录',

  // 设置
  'settings.title': '设置',
  'settings.tab.account': '账号', 'settings.tab.premium': '高级版', 'settings.tab.general': '通用',
  'settings.tab.pomodoro': '番茄钟', 'settings.tab.lists': '清单管理', 'settings.tab.appearance': '外观',
  'settings.tab.about': '关于',
  'pomodoro.focusLen': '专注时长', 'pomodoro.breakLen': '休息时长',
  'pomodoro.longBreakLen': '长休息时长', 'pomodoro.longBreakEvery': '长休息间隔',
  'pomodoro.dailyGoal': '每日目标时长', 'pomodoro.autoNext': '自动开始下一轮',
  'pomodoro.minutes': '分钟', 'pomodoro.poms': '个番茄',
  'notif.inApp': '应用内通知', 'notif.system': '系统通知',
  'appearance.lang': '语言', 'appearance.theme': '主题', 'appearance.wallpaper': '专注背景',
  'appearance.noise': '白噪音', 'appearance.noiseFocus': '专注时播放', 'appearance.noiseBreak': '休息时播放',
  'appearance.now': '海浪', 'appearance.yesNo': '是',
  'account.avatar': '头像', 'account.username': '用户名', 'account.email': '账号',
  'account.password': '密码', 'account.accountMgmt': '账号管理',
  'account.changeAccount': '修改账号', 'account.changePassword': '修改密码',
  'account.deleteData': '删除数据', 'account.logout': '注销账号', 'account.save': '保存',
  'account.pwdPlaceholder': '新密码', 'account.pwdConfirm': '确认密码',

  // 云同步（PocketBase）
  'sync.title': '云同步', 'sync.desc': '登录后可把配置备份到云端，并在多台设备间同步；断网时仍使用本地数据。',
  'sync.email': '邮箱', 'sync.password': '密码',
  'sync.login': '登录', 'sync.register': '注册',
  'sync.toRegister': '没有账号？去注册', 'sync.toLogin': '已有账号？去登录',
  'sync.push': '推送本地配置', 'sync.pull': '拉取云端配置', 'sync.logout': '退出登录',
  'sync.lastSync': '上次同步 {v}',
  'common.save': '保存', 'common.cancel': '取消', 'common.confirm': '确定',
  'common.delete': '删除', 'common.yes': '知道了',
  'confirm.deleteDataTitle': '删除数据',
  'confirm.deleteDataMsg': '此操作将清空本地全部任务、清单、专注记录、通知与设置，且不可恢复。确定继续吗？',
  'confirm.logoutMsg': '注销将退出当前账号并清理本地数据。确定继续吗？',

  // 通知
  'notif.title': '通知', 'notif.allRead': '全部已读', 'notif.none': '暂无通知',
  'notif.focusDoneTitle': '番茄完成', 'notif.focusDoneBody': '你完成了一个专注番茄，休息一下吧。',
  'notif.breakDoneTitle': '休息结束', 'notif.breakDoneBody': '休息结束，开始下一个专注番茄。',
  'notif.remindTitle': '任务到期提醒',
  'search.placeholder2': '搜索任务或清单，回车定位',
  'search.hint': '↑↓ 选择 · 回车 定位', 'search.empty': '输入关键词开始搜索', 'search.noResult': '无匹配结果',
  'search.task': '任务', 'search.list': '清单',
} as const;

export type ZhKey = keyof typeof zh;
