# Blender-конвейер: как запустить локально

Регламент для агента: `docs/BLENDER_PIPELINE.md`. ТЗ на модели и анимации: `docs/ASSETS_SPEC.md`.
Эта папка: `scripts/` (bpy-скрипты и проверка), `src/` (исходные `.blend`), `originals/` (бэкап оригинальных `.glb`, заполняется в фазе 0).

## Что нужно на компьютере

| Что | Зачем | Проверка |
|---|---|---|
| Blender 4.2 LTS или новее | сборка и экспорт, запуск `blender -b` | `blender --version` |
| Blender MCP (аддон + MCP-сервер) | агент смотрит и правит живую сцену | в Claude Code: `/mcp` показывает blender |
| Node.js 18+ | `npm test`, `tools/shot.cjs`, `npx @gltf-transform/cli` | `node -v` |
| Python 3 + numpy | `blender/scripts/verify_glb.py` (без Blender) | `python3 -c "import numpy"` |
| Playwright с Chromium | скриншоты игры | `npx playwright install chromium` (один раз) |

Blender должен быть доступен как команда `blender`. На Windows и macOS добавь его в PATH или вызывай по полному пути.

## Первый запуск

```sh
git clone https://github.com/Sekach57/kamnelom && cd kamnelom
git checkout -b art/blender-pipeline
npm install --no-save playwright        # только если Playwright ещё не стоит
python3 blender/scripts/verify_glb.py dist/assets/dwarf.glb
node tools/shot.cjs solo
```

Первая команда выдаёт JSON-отчёт по гному (должно быть `"ok": true`), вторая сохраняет `tmp/shots/solo.png` и печатает клипы и меши,
которые видит игра. Если обе работают, окружение готово.

Откройте Claude Code в корне репозитория, подключите Blender MCP и дайте первое задание:

> Прочитай `AGENTS.md`, `docs/BLENDER_PIPELINE.md` и `docs/ASSETS_SPEC.md`. Выполни только Фазу 0 и остановись с отчётом.

Следующую фазу давайте после просмотра отчёта: contact sheets, таблица проверок, скриншот из игры.

## Проверки (готовы)

```sh
# отчёт по файлу: вес, треугольники, текстуры, кости против эталона, клипы, дрейф таза, скольжение ступней, позы hit против ready
python3 blender/scripts/verify_glb.py dist/assets/dwarf.glb

# то же плюс сравнение с оригиналом (для round-trip теста фазы 0): identical=true, если клипы и позы совпали
python3 blender/scripts/verify_glb.py blender/out/dwarf.glb --compare blender/originals/dwarf.glb

# валидатор и сводка glTF
npx @gltf-transform/cli validate dist/assets/dwarf.glb
npx @gltf-transform/cli inspect dist/assets/dwarf.glb

# игра: скриншот и список клипов и мешей, которые увидел GLTFLoader (solo | build | party)
node tools/shot.cjs solo
node tools/shot.cjs build
npm test && npm run check
```

`verify_glb.py` завершается кодом 1 при нарушении инвариантов, поэтому его можно вешать на хук или CI. Пороги: дрейф таза 0.01 ед. (смещение
последнего кадра от первого), скольжение ступни 0.01 ед., расхождение первой и последней позы strike-клипа с `*_ready` 1°.
Клипы Meshy из `dwarf_moves.glb` (ходьба, переходы) исключены: они по природе двигают таз и ступни. На сжатых Meshopt файлах проверяется
только структура (анимации не распаковываются): сравнивай позы до сжатия, а после сжатия проверяй игрой и `inspect`.

## Что уже известно про текущие ассеты (проверено `verify_glb.py` 29.10.2026)

| Файл | Размер | Треугольники | Текстура | Куда уходит вес | Бюджет |
|---|---|---|---|---|---|
| `dwarf.glb` | 4.7 МБ | 12 342 | JPEG 2048×2048, 3.2 МБ | текстура 69%, геометрия 25%, анимации 4% | ≤ 6 МБ со всеми частями |
| `dwarf_moves.glb` | 0.27 МБ | нет (только анимации) | нет | анимации | |
| `hammer.glb` | 4.0 МБ | 12 099 | JPEG 2048×2048, 3.3 МБ | текстура 82%, геометрия 18% | ≤ 0.5 МБ |
| `boulder.glb` | 3.4 МБ | 8 152 | JPEG 2048×2048, 2.8 МБ | текстура 84%, геометрия 16% | ≤ 1 МБ |

- Все оригинальные клипы гнома проходят проверки: дрейф 0, ступни не скользят, strike начинается и заканчивается в позе ready (0.0°), кость `Hammer` анимирована.
- Скелет: 24 эталонные кости и `Hammer`, лишних нет.
- Текстуры 2048 px при рендере ~270 px избыточны: сжатие до 512 px даёт большую часть экономии. Молоту и валуну для бюджета дополнительно нужно прореживание (decimate).
- Strike-клипы: swing_hit и pushup_hit длятся 1.17 с, squat_hit 1.0 с. Это длина клипа целиком; важно, что видимый удар заканчивается раньше 0.8 с (проверять глазами).

## Что подготовлено в коде игры

- `dist/vendor/three/meshopt_decoder.module.js` (MIT, meshoptimizer, из three r160) и `setMeshoptDecoder` в `dist/scene3d.js`: игра читает сжатые Meshopt `.glb`;
  несжатые файлы грузятся как раньше (проверено: игра грузится без ошибок, `npm test` и `npm run check` проходят).
- `tools/shot.cjs`: скриншоты и диагностика загрузки ассетов.

## Чего здесь нет и что придётся делать на месте

- Сами bpy-скрипты (импорт, превью-камера, contact sheets, экспорт): агент пишет их в фазе 0 в `blender/scripts/`.
- Превью-камера Blender, повторяющая игровую: параметры (ортографическая, 30° вниз по умолчанию, `ELEV` .52 рад в соло, .8 в группе) берутся из `create()` в `dist/scene3d.js`.
- Рендер contact sheet на 270 и 70 px: в Blender (Workbench или EEVEE), затем уменьшение Pillow с `Image.NEAREST`.
