// dx-youken-app の画面の設定。秘密の値は置かない。
// googleClientId＝Google Cloud プロジェクト KamoBase-Production（kamozaki0413@kamobase.com）の OAuth クライアントID（ウェブアプリ・名前 dx-youken-app）。公開されても問題ない値。
//   承認済みの JavaScript 生成元は https://hisao-k.github.io。公開先を変えたらここも変える。
// GAS（データの出し入れ）の URL は、設定用リンク（?api=...）で端末に覚えさせる（名刺管理君・議事録デスクと同じ）。
// devIdToken は手元の模擬環境（localhost）だけで使う。公開する前に空にする（publish-web.sh が止める）。
window.DXY_CONFIG = {
  googleClientId: '492849036491-kfbch1qap406i8gab5un6neouigg9ka6.apps.googleusercontent.com',
  devIdToken: '',
};
