/** Neo gắn toolbar — không chèn vào DOM form (tránh vỡ layout Vue/Ant). */

function findBigsellerImageBetweenAnchors() {
    const bar =
        document.querySelector('.image_action.flex.between') ??
        document.querySelector('[class*="shopee_media_info_wrap"] .image_action') ??
        document.querySelector('.image_action');
    if (!bar)
        return null;
    let leftEl = null;
    for (const el of bar.querySelectorAll('.ant-form-item-children, span')) {
        if (/chọn\s*hình\s*ảnh/i.test(el.textContent ?? '')) {
            leftEl = el;
            break;
        }
    }
    let rightEl = null;
    for (const el of bar.querySelectorAll('.product_edit_img_action_item')) {
        if (/chỉnh\s*sửa\s*hình/i.test(el.textContent ?? '')) {
            rightEl = el;
            break;
        }
    }
    if (!leftEl || !rightEl)
        return null;
    return { left: leftEl, right: rightEl, bar };
}

export function findImageActionAnchor(platform) {
    if (platform === 'bigseller') {
        return (
            document.querySelector('.image_action.flex.between') ??
            document.querySelector('[class*="shopee_media_info_wrap"] .image_action') ??
            document.querySelector('.image_action')
        );
    }
    const basic = document.querySelector('.product-basic-info');
    if (!basic)
        return null;
    for (const div of basic.querySelectorAll(
        '.edit-main > div, .edit-row .edit-main > div',
    )) {
        const t = div.textContent?.trim() ?? '';
        if (/hình\s*ảnh.*1\s*:?\s*1|1\s*:?\s*1.*hình/i.test(t))
            return div;
    }
    return basic.querySelector('.edit-row .edit-main > div');
}

/**
 * @returns {{ mode: 'between', left: Element, right: Element } | { mode: 'anchor', anchor: Element, align: string } | null}
 */
export function getImageToolbarPlacement(platform) {
    if (platform === 'bigseller') {
        const between = findBigsellerImageBetweenAnchors();
        if (between)
            return { mode: 'between', left: between.left, right: between.right };
    }
    const anchor = findImageActionAnchor(platform);
    if (!anchor)
        return null;
    return { mode: 'anchor', anchor, align: 'right-top' };
}

export function findDescriptionActionAnchor(platform) {
    if (platform === 'bigseller') {
        const sku = document.querySelector('input[autoid="parent_sku_text"]');
        return sku?.closest('.content') ?? null;
    }
    for (const el of document.querySelectorAll(
        '.product-description-panel .basic-info-title, .product-description-panel .panel-title .basic-info-title, .product-description-panel .panel-title',
    )) {
        if (/mô\s*tả/i.test(el.textContent ?? ''))
            return el;
    }
    return document.querySelector('.product-description-panel .panel-title');
}

function findBigsellerParentSkuField() {
    const input = document.querySelector('input[autoid="parent_sku_text"]');
    if (!input)
        return null;
    const content = input.closest('.content');
    if (!content)
        return null;
    const leftEl =
        input.closest('.w_300, .input_expand, .limit_length_ipt, .bs_antd_input_outer') ??
        input;
    return { content, left: leftEl };
}

/**
 * @returns {{ mode: 'right-of', left: Element, boundary: Element } | { mode: 'anchor', anchor: Element, align: string } | null}
 */
export function getDescriptionToolbarPlacement(platform) {
    if (platform === 'bigseller') {
        const sku = findBigsellerParentSkuField();
        if (sku)
            return { mode: 'right-of', left: sku.left, boundary: sku.content };
    }
    const anchor = findDescriptionActionAnchor(platform);
    if (!anchor)
        return null;
    return {
        mode: 'anchor',
        anchor,
        align: platform === 'bigseller' ? 'right-top' : 'right-below',
    };
}
