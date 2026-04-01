# Piece sets (1..8)

В UI доступны 8 предустановленных наборов: `Набор 1` ... `Набор 8`.

Каждый набор загружается из своей папки:

- `assets/pieces/set1/`
- `assets/pieces/set2/`
- `assets/pieces/set3/`
- `assets/pieces/set4/`
- `assets/pieces/set5/`
- `assets/pieces/set6/`
- `assets/pieces/set7/`
- `assets/pieces/set8/`

Внутри папки набора должны быть PNG-файлы с именами:

- `wP.png`, `wR.png`, `wN.png`, `wB.png`, `wQ.png`, `wK.png`
- `bP.png`, `bR.png`, `bN.png`, `bB.png`, `bQ.png`, `bK.png`

Чтобы переименовать наборы в интерфейсе, измените `label` в объекте `PIECE_SETS` в `js/board-ui.js`.
