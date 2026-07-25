
---

name: yangqin-miniprogram

description: Develop and review the Yangqin speech-training WeChat mini program, including student training, recording, AI feedback, teacher review, sharing posters, and CloudBase.

---

Use this skill in the Yangqin speech-training mini program project.

Project context:

- product name: 杨勤口才训练 KEEP

- users: adults, college students, pre-college students, professionals, managers

- roles: student, teacher, admin

- cloud env: cloud1-d0geb9qt9d29ee6fc

- AI provider preference: cloudbase-ai, qwen/deepseek providers

- important features: recording/video upload, daily training, AI feedback, teacher comments, class assignments, work history, share poster, assessment

When coding:

- preserve existing UI style unless asked

- avoid breaking WeChat Mini Program size limits

- be careful with media upload limits and source package size

- prefer small targeted changes

- keep fallback behavior for images, posters, avatars, and upload failure

- use Chinese user-facing copy

For every change, check:

- WXML/WXSS/JS consistency

- cloud function compatibility

- package size

- mobile layout

- fallback/error state

