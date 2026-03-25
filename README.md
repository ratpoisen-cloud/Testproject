# FentanylChess
Как использовать папку assets/?
В файле js/app.js в настройках доски есть параметр pieceTheme. Если ты скачаешь свои картинки фигур (например, в стиле "Neo" или "Wood") и положишь их в assets/pieces/, то измени строку на:
pieceTheme: 'assets/pieces/{piece}.png'
