(function () {
  function xmlElementsByName(xml, name) {
    return Array.from(xml.getElementsByTagName("*")).filter(element => element.localName === name);
  }

  function xmlAttributeByName(element, name) {
    return Array.from(element.attributes).find(attribute => attribute.localName === name)?.value;
  }

  function directChildren(element, name) {
    return Array.from(element?.children || []).filter(child => child.localName === name);
  }

  function resolveZipPath(baseFilePath, target) {
    if (target.startsWith("/")) return target.slice(1);

    const parts = baseFilePath.split("/");
    parts.pop();
    target.split("/").forEach(part => {
      if (!part || part === ".") return;
      if (part === "..") parts.pop();
      else parts.push(part);
    });

    return parts.join("/");
  }

  function readRelationships(xml) {
    return new Map(xmlElementsByName(xml, "Relationship").map(relationship => [
      relationship.getAttribute("Id"),
      relationship.getAttribute("Target")
    ]));
  }

  async function extractWorkbookImages(workbookBytes, firstSheetName) {
    const zip = await JSZip.loadAsync(workbookBytes);
    const parser = new DOMParser();
    const imagesByRow = new Map();
    const mimeByExtension = {
      bmp: "image/bmp", gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg",
      png: "image/png", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp"
    };
    const parseXml = (text, path) => {
      const xml = parser.parseFromString(text, "application/xml");
      const parserError = xml.getElementsByTagName("parsererror")[0];
      if (parserError) throw new Error(`Invalid XML in ${path}: ${parserError.textContent}`);
      return xml;
    };
    const readXml = async path => {
      const file = zip.file(path);
      if (!file) throw new Error(`Workbook relationship points to missing file: ${path}`);
      return parseXml(await file.async("text"), path);
    };
    const addImageForRow = async (rowNumber, imagePath) => {
      const imageFile = zip.file(imagePath);
      if (!imageFile) throw new Error(`Embedded image file not found: ${imagePath}`);

      const imageBytes = await imageFile.async("uint8array");
      if (!imageBytes.length) throw new Error(`Embedded image file is empty: ${imagePath}`);

      const extension = imagePath.split(".").pop().toLowerCase();
      const image = {
        blob: new Blob([imageBytes], { type: mimeByExtension[extension] || "application/octet-stream" }),
        name: imagePath.split("/").pop()
      };
      if (!imagesByRow.has(rowNumber)) imagesByRow.set(rowNumber, []);
      imagesByRow.get(rowNumber).push(image);
    };

    const workbookPath = "xl/workbook.xml";
    const workbookXml = await readXml(workbookPath);
    const workbookRelationships = readRelationships(await readXml("xl/_rels/workbook.xml.rels"));
    const sheetElement = xmlElementsByName(workbookXml, "sheet")
      .find(element => element.getAttribute("name") === firstSheetName);
    const sheetTarget = sheetElement && workbookRelationships.get(xmlAttributeByName(sheetElement, "id"));
    if (!sheetTarget) throw new Error(`Could not resolve worksheet "${firstSheetName}" in the workbook.`);

    const sheetPath = resolveZipPath(workbookPath, sheetTarget);
    const sheetXml = await readXml(sheetPath);

    const metadataPath = "xl/metadata.xml";
    if (zip.file(metadataPath)) {
      const metadataXml = await readXml(metadataPath);
      const richDataPath = "xl/richData/rdrichvalue.xml";
      const structuresPath = "xl/richData/rdrichvaluestructure.xml";
      const richValueRelationshipsPath = "xl/richData/richValueRel.xml";
      const richValueRelationshipFilesPath = "xl/richData/_rels/richValueRel.xml.rels";
      const richValueData = await readXml(richDataPath);
      const richValueStructures = await readXml(structuresPath);
      const richValueRelationships = await readXml(richValueRelationshipsPath);
      const richValueRelationshipFiles = readRelationships(await readXml(richValueRelationshipFilesPath));

      const metadataTypesElement = xmlElementsByName(metadataXml, "metadataTypes")[0];
      const metadataTypes = directChildren(metadataTypesElement, "metadataType");
      const richValueTypeIndex = metadataTypes.findIndex(type => type.getAttribute("name") === "XLRICHVALUE");
      const valueMetadata = xmlElementsByName(metadataXml, "valueMetadata")[0];
      const valueMetadataEntries = directChildren(valueMetadata, "bk");
      const futureMetadata = xmlElementsByName(metadataXml, "futureMetadata")
        .find(element => element.getAttribute("name") === "XLRICHVALUE");
      const futureMetadataEntries = directChildren(futureMetadata, "bk");
      const richValues = directChildren(xmlElementsByName(richValueData, "rvData")[0], "rv");
      const structures = directChildren(xmlElementsByName(richValueStructures, "rvStructures")[0], "s");
      const relatedImages = directChildren(xmlElementsByName(richValueRelationships, "richValueRels")[0], "rel");

      for (const cell of xmlElementsByName(sheetXml, "c")) {
        const cellMetadataIndex = Number(cell.getAttribute("vm")) - 1;
        const metadataEntry = valueMetadataEntries[cellMetadataIndex];
        if (!Number.isInteger(cellMetadataIndex) || !metadataEntry || richValueTypeIndex < 0) continue;

        const richValueReference = directChildren(metadataEntry, "rc")
          .find(reference => Number(reference.getAttribute("t")) - 1 === richValueTypeIndex);
        if (!richValueReference) continue;

        const futureEntry = futureMetadataEntries[Number(richValueReference.getAttribute("v"))];
        const richValueBlock = futureEntry && xmlElementsByName(futureEntry, "rvb")[0];
        if (!richValueBlock) throw new Error(`Missing rich-value metadata for cell ${cell.getAttribute("r")}.`);

        const richValue = richValues[Number(richValueBlock.getAttribute("i"))];
        if (!richValue) throw new Error(`Missing rich-value entry for cell ${cell.getAttribute("r")}.`);

        const structure = structures[Number(richValue.getAttribute("s"))];
        const structureKeys = directChildren(structure, "k");
        const imageIdentifierIndex = structureKeys.findIndex(key =>
          key.getAttribute("n") === "_rvRel:LocalImageIdentifier"
        );
        if (imageIdentifierIndex < 0) continue;

        const richValueFields = directChildren(richValue, "v");
        const imageIdentifier = Number(richValueFields[imageIdentifierIndex]?.textContent);
        const imageRelationship = relatedImages[imageIdentifier];
        const relationshipId = imageRelationship && xmlAttributeByName(imageRelationship, "id");
        const imageTarget = relationshipId && richValueRelationshipFiles.get(relationshipId);
        if (!imageTarget) throw new Error(`Could not resolve in-cell picture for cell ${cell.getAttribute("r")}.`);

        const cellReference = cell.getAttribute("r");
        const rowMatch = cellReference && cellReference.match(/\d+$/);
        if (!rowMatch) throw new Error(`Invalid worksheet cell reference: ${cellReference}`);

        const imagePath = resolveZipPath(richValueRelationshipsPath, imageTarget);
        await addImageForRow(Number(rowMatch[0]) - 1, imagePath);
      }
    }

    const drawingElement = xmlElementsByName(sheetXml, "drawing")[0];
    if (drawingElement) {
      const sheetRelationshipsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
      const sheetRelationships = readRelationships(await readXml(sheetRelationshipsPath));
      const drawingTarget = sheetRelationships.get(xmlAttributeByName(drawingElement, "id"));
      if (!drawingTarget) throw new Error(`Could not resolve the picture drawing for worksheet "${firstSheetName}".`);

      const drawingPath = resolveZipPath(sheetPath, drawingTarget);
      const drawingXml = await readXml(drawingPath);
      const anchors = xmlElementsByName(drawingXml, "twoCellAnchor")
        .concat(xmlElementsByName(drawingXml, "oneCellAnchor"));
      const pictureAnchors = anchors.filter(anchor => xmlElementsByName(anchor, "pic").length);

      if (pictureAnchors.length) {
        const drawingRelationshipsPath = drawingPath.replace(/([^/]+)$/, "_rels/$1.rels");
        const drawingRelationships = readRelationships(await readXml(drawingRelationshipsPath));

        for (const anchor of pictureAnchors) {
          const from = xmlElementsByName(anchor, "from")[0];
          const rowElement = from && xmlElementsByName(from, "row")[0];
          const blip = xmlElementsByName(anchor, "pic")[0]
            && xmlElementsByName(xmlElementsByName(anchor, "pic")[0], "blip")[0];
          if (!rowElement || !blip) {
            throw new Error("Found an embedded picture without a usable worksheet row anchor.");
          }

          const imageTarget = drawingRelationships.get(xmlAttributeByName(blip, "embed"));
          if (!imageTarget) throw new Error("Found an embedded picture without a media-file relationship.");

          const imagePath = resolveZipPath(drawingPath, imageTarget);
          await addImageForRow(Number(rowElement.textContent), imagePath);
        }
      }
    }

    const imageCount = Array.from(imagesByRow.values())
      .reduce((total, images) => total + images.length, 0);
    console.info(`Workbook image extraction found ${imageCount} image(s) across ${imagesByRow.size} row(s).`);

    return imagesByRow;
  }

  window.extractWorkbookImages = extractWorkbookImages;
})();