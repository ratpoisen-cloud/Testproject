# Custom chess pieces

To use your own chess pieces in the app:

1. Open board settings and choose **Кастомные (assets)** in the "Фигурки" selector.
2. Put your SVG files into `assets/pieces/custom/`.
3. Use these exact file names (case-sensitive):

- `wP.svg`, `wR.svg`, `wN.svg`, `wB.svg`, `wQ.svg`, `wK.svg`
- `bP.svg`, `bR.svg`, `bN.svg`, `bB.svg`, `bQ.svg`, `bK.svg`

If no piece set is selected (or saved value is invalid), the board uses the original CDN set:

`https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png`

When the custom set is selected, the board loads pieces from:

`assets/pieces/custom/{piece}.svg`
