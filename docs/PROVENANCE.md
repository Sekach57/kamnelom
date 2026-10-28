# Происхождение и версии

Дата экспорта: 2026-10-28.

Камнелом: актуальные dist/ и tests/ скопированы без изменений из последней
опубликованной версии, commit 2a492af3974e514999282fe1b6bae94de3248d25.
Первая версия: d4b7f7aef796f88875ab3adab1aeaff760331a69.
Разница двух версий сохранена как history/front-camera-onboarding.patch.
README, документация, AGENTS.md, package.json и tools созданы для переноса.

Текущий опубликованный прототип:
https://dwarf-kettlebell-swings.steadycivet22.chatgpt.site

Предыдущая игра для гребли:
https://strumok-pixel-river-a13.steadycivet22.chatgpt.site

В архиве reference/strumok — отдельный гребной прототип, не режим Камнелома.
Запуск: npm run dev:rowing, затем http://localhost:4174.
Проверка: npm run test:rowing.

Добавлено после экспорта: `dist/vendor/mediapipe/` — `@mediapipe/tasks-vision` 1.1.1
(npm, Apache-2.0, LICENSE рядом) и `pose_landmarker_lite.task` (Google, MediaPipe Models,
SHA-256 в docs/POSE_MODEL.md). `dist/detector.js` и `tests/detector.cjs` удалены. `dist/vendor/qr/`: qrcode-generator 1.4.4 (MIT) и jsQR 1.4.0 (Apache-2.0) для QR-подключения телефона и экрана; `dist/vendor/peerjs/`: PeerJS 1.5.5 (MIT) для комнат телефон+экран (внешний брокер, см. docs/REMOTE.md).

Из экспорта исключены .git и хостинговая конфигурация .openai, идентификаторы
аккаунта, git credentials и токены. Для другого репозитория они не нужны.
Нет сторонних шрифтов/изображений/аудио: всё нарисовано или синтезировано кодом.
История беседы передана в форме требований, хода работ и следующего задания;
это не дословный экспорт чата. Исходных видео пользователя нет.

Ранее опубликованные сайты экспортом не изменены. Старый вход через ChatGPT
не перенесён: это внешняя защита хостинга. При размещении на другом сервисе
настрой доступ отдельно, если сайт должен оставаться приватным.
