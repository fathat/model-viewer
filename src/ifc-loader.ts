import * as WEBIFC from "web-ifc"

import wasmURL from "web-ifc/web-ifc.wasm?url"

const ifcAPI = new WEBIFC.IfcAPI()

// We need to set the directory for the WASM file, as normally it'd
// try to read it out of the root of the server. (SetWasmPath is somewhat
// confusingly named -- it doesn't include the filename). We want to serve it out of
// node_modules so that we don't have to copy it into our public directory. (
// which could be problematic if someone updated the library and we forgot to update
// our copy of the WASM file).
const wasmDir = wasmURL.substring(0, wasmURL.lastIndexOf("/") + 1)
ifcAPI.SetWasmPath(wasmDir)

let loaderInitialized = false

export async function loadIfcModel(data: Uint8Array) {
    if (!loaderInitialized) {
        await ifcAPI.Init()
        loaderInitialized = true
        console.log("IFC loader initialized")
    }

    console.log(`Loading IFC model... ${data.length} bytes`)

    const modelId = ifcAPI.OpenModel(data)

    ifcAPI.CloseModel(modelId)
}