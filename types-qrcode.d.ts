declare module 'qrcode' {
  interface Options {
    type?: 'svg' | 'utf8' | 'terminal'
    margin?: number
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }
  const QRCode: { toString(text: string, options?: Options): Promise<string> }
  export default QRCode
}
