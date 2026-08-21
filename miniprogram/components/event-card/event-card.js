// components/event-card/event-card.js —— 事件只读展示卡片
Component({
  properties: {
    event: {
      type: Object,
      value: {},
      observer(val) { this.compute(val); },
    },
  },
  data: { timeText: '', peopleText: '' },
  lifetimes: {
    attached() { this.compute(this.data.event); },
  },
  methods: {
    compute(e) {
      if (!e) return;
      const t = (e.start_time ? e.start_time : '待定') + (e.end_time ? ' - ' + e.end_time : '');
      this.setData({ timeText: t, peopleText: (e.people || []).join('、') });
    },
  },
});
