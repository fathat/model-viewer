import * as WEBIFC from "web-ifc"

import wasmURL from "web-ifc/web-ifc.wasm?url"

const ifcAPI = new WEBIFC.IfcAPI()
ifcAPI.SetWasmPath(wasmURL)

console.log(wasmURL)

let loaderInitialized = false

export async function loadIfcModel(data: Uint8Array) {
    if (!loaderInitialized) {
        await ifcAPI.Init()
        loaderInitialized = true
    }

    const modelId = ifcAPI.OpenModel(data)

    ifcAPI.CloseModel(modelId)
}