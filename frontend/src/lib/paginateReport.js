export async function waitForReportAssets(node) {
  await document.fonts.ready;
  await Promise.all(Array.from(node.querySelectorAll("img"), (img) => {
    if (img.complete) return Promise.resolve(); // Includes failed/empty URLs.
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        img.removeEventListener("load", done);
        img.removeEventListener("error", done);
        resolve();
      };
      const timer = setTimeout(done, 15000);
      img.addEventListener("load", done);
      img.addEventListener("error", done);
    });
  }));
}

function collectBlocks(source) {
  const blocks = [];
  const visit = (node) => {
    if (node.matches(".sr-section, .sr-appendix-intro-block, [data-report-flow]")) {
      Array.from(node.children).forEach(visit);
    } else if (node.matches("ul, ol")) {
      Array.from(node.children).forEach((item, index) => {
        const list = node.cloneNode(false);
        if (node.tagName === "OL") list.start = (Number(node.start) || 1) + index;
        list.append(item.cloneNode(true));
        blocks.push(list);
      });
    } else {
      blocks.push(node.cloneNode(true));
    }
  };
  Array.from(source.children).forEach(visit);
  // Keep section headings with the following paragraph, and captions with images.
  const grouped = [];
  let pending = [];
  for (const block of blocks) {
    pending.push(block);
    if (block.matches(".sr-section-h, .sr-sub-title, .sr-appendix-main-title, .sr-figure-title, .sr-header-top")) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "sr-flow-block";
    wrapper.append(...pending);
    grouped.push(wrapper);
    pending = [];
  }
  if (pending.length) grouped.push(...pending);
  return grouped;
}

// Split at a word boundary while retaining inline markup (strong, emphasis, lists).
function splitTextBlock(block, fits) {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const positions = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (const match of node.textContent.matchAll(/\S+\s*/gu)) {
      positions.push([node, match.index + match[0].length]);
    }
  }
  const fragment = (index, tail = false) => {
    const range = document.createRange();
    range.selectNodeContents(block);
    const [node, offset] = positions[index];
    if (tail) range.setStart(node, offset);
    else range.setEnd(node, offset);
    const part = block.cloneNode(false);
    part.append(range.cloneContents());
    if (tail) part.classList.add("sr-flow-continuation");
    return part;
  };
  let low = 0;
  let high = positions.length - 2;
  let best = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(fragment(middle))) { best = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return best < 0 ? null : [fragment(best), fragment(best, true)];
}

export function paginateReport(source, target, footerTemplate) {
  target.replaceChildren();
  let body;
  let pageNumber = 0;
  const newPage = () => {
    const page = document.createElement("div");
    page.className = "preview-a4 preview-a4-landscape sr-page-a4 sr-auto-page";
    const footer = footerTemplate.cloneNode(true);
    footer.querySelector(".sr-page-num").textContent = ++pageNumber;
    body = document.createElement("div");
    body.className = "sr-auto-body";
    page.append(body, footer);
    target.append(page);
    // Reserve the measured footer height, including a gap, instead of guessing
    // how many lines the confidentiality notice will occupy.
    const height = footer.offsetTop - body.offsetTop - 12;
    if (height <= 0) throw new Error("Không đủ chiều cao để dàn trang báo cáo.");
    body.style.height = `${height}px`;
  };
  const fits = (block) => {
    body.append(block);
    const result = body.scrollHeight <= body.clientHeight;
    block.remove();
    return result;
  };
  newPage();
  for (let block of collectBlocks(source)) {
    // Start the appendix on a fresh page, without inserting an empty page.
    const startsAppendix = block.matches(".sr-appendix-main-title")
      || block.querySelector(".sr-appendix-main-title");
    if (startsAppendix && body.childElementCount) newPage();
    if (!fits(block) && body.childElementCount) newPage();
    while (!fits(block)) {
      if (block.querySelector("img")) {
        // An indivisible figure taller than a page is reduced as a whole.
        body.append(block);
        const scale = Math.min(1, body.clientHeight / block.offsetHeight);
        const holder = document.createElement("div");
        holder.style.height = `${block.offsetHeight * scale}px`;
        holder.style.overflow = "hidden";
        block.style.transformOrigin = "top center";
        block.style.transform = `scale(${scale})`;
        holder.append(block);
        body.append(holder);
        block = null;
        break;
      }
      const parts = splitTextBlock(block, fits);
      if (!parts) throw new Error("Không thể dàn nội dung vào trang A4.");
      body.append(parts[0]);
      newPage();
      block = parts[1];
    }
    if (block) body.append(block);
  }
}
