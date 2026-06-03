/**
 * Ánh xạ trường sản phẩm chung giữa BigSeller và Shopee (banhang).
 * Nguồn: chi tiết sản phẩm trang bigseller.htm, chi tiết sản phẩm trang banhang shopee.htm
 */

export type ProductPlatform = 'bigseller' | 'shopee';

export type ProductFieldKey = 'title' | 'description';

export type FieldElementKind = 'input' | 'textarea' | 'plain-text-container';

export interface PlatformFieldElement {
  platform: ProductPlatform;
  /** CSS selectors ưu tiên từ cao xuống thấp */
  selectors: string[];
  /** Đường DOM (tham khảo khi debug / cập nhật selector) */
  domPath: string;
  kind: FieldElementKind;
  /** Thuộc tính HTML đặc trưng trên snapshot trang */
  htmlHints?: Record<string, string>;
}

export interface ProductFieldDefinition {
  key: ProductFieldKey;
  label: string;
  maxLength: number;
  /** Ghi chú giới hạn nhập liệu */
  inputNotes: string;
  bigseller: PlatformFieldElement;
  shopee: PlatformFieldElement;
}

export const PRODUCT_FIELD_ELEMENTS: ProductFieldDefinition[] = [
  {
    key: 'title',
    label: 'Tên sản phẩm',
    maxLength: 120,
    inputNotes: 'Tối đa 120 ký tự',
    bigseller: {
      platform: 'bigseller',
      selectors: [
        'input[autoid="product_name_text"]',
        '.product_name.chat_name_form input.ant-input',
        '.page_edit_item .product_name input.ant-input',
      ],
      domPath:
        'div#app > div.__root > div.page_edit > div.page_edit_body > div.com_card.mb_20:nth-child(1) > div.com_card_body > form.ant-form > div.page_edit_item:nth-child(2) > div.content > div.product_name > div.ant-form-item-control > span.ant-form-item-children > span.ant-input-group-wrapper > span.ant-input-group > input.ant-input',
      kind: 'input',
      htmlHints: {
        autoid: 'product_name_text',
        class: 'ant-input',
      },
    },
    shopee: {
      platform: 'shopee',
      selectors: [
        '[data-product-edit-field-unique-id="name"] input.eds-input__input',
        '.product-name-editor input.eds-input__input',
        '.product-edit-form-item.custom-len-calc-input input.eds-input__input',
      ],
      domPath:
        'div#app > div.full-screen-container > div.page > div.product > div.product-detail > div.product-edit > div.product-edit__main > section.product-edit__section:nth-child(1) > div.product-detail-panel.product-basic-info > div.panel-content > div.edit-row > div.edit-main > div.product-name-editor > div.product-edit-form-item > div.product-edit-form-item-content > div.eds-input > div.eds-input__inner--large > input.eds-input__input',
      kind: 'input',
      htmlHints: {
        class: 'eds-input__input',
        placeholder:
          'Tên sản phẩm + Thương hiệu + Model + Thông số kỹ thuật',
      },
    },
  },
  {
    key: 'description',
    label: 'Mô tả sản phẩm',
    maxLength: 3000,
    inputNotes:
      'Tối đa 3000 ký tự; chỉ văn bản thuần, có thể xuống dòng, không định dạng rich text',
    bigseller: {
      platform: 'bigseller',
      selectors: [
        'textarea[autoid="product_description_text"]',
        '.textarea_count textarea.w_full.min_h_250.ant-input',
        'textarea.min_h_250.ant-input',
      ],
      domPath:
        'div#app > div.__root > div.page_edit > div.page_edit_body > div.com_card.mb_20:nth-child(2) > div.com_card_body > form.ant-form > div.page_edit_item:nth-child(3) > div.content > div.ant-form-item > span.ant-form-item-children > div.textarea_count > textarea.w_full.min_h_250.ant-input',
      kind: 'textarea',
      htmlHints: {
        autoid: 'product_description_text',
        class: 'w_full min_h_250 ant-input',
      },
    },
    shopee: {
      platform: 'shopee',
      selectors: [
        '.editor-outer',
        '[data-product-edit-field-unique-id="description"] .editor-outer',
        '[data-product-edit-field-unique-id="description"]',
        '.product-description-editor',
        '[data-product-edit-field-unique-id="description"] textarea',
        '[data-product-edit-field-unique-id="description"] .ql-editor',
        '.product-description-editor .ql-editor',
      ],
      domPath:
        'div#app > div.full-screen-container > div.page > div.product > div.product-detail > div.product-edit > div.product-edit__main > section > div.product-detail-panel > div.panel-content > div.editor-outer',
      kind: 'plain-text-container',
      htmlHints: {
        class: 'editor-outer',
        dataLsUploadCmpt: 'true',
      },
    },
  },
];

/** Selectors theo platform — dùng trong content script adapters */
export function getFieldSelectors(
  key: ProductFieldKey,
  platform: ProductPlatform,
): string[] {
  const field = PRODUCT_FIELD_ELEMENTS.find((f) => f.key === key);
  if (!field) return [];
  const el = platform === 'bigseller' ? field.bigseller : field.shopee;
  return el.selectors;
}

export function getFieldMaxLength(key: ProductFieldKey): number {
  return PRODUCT_FIELD_ELEMENTS.find((f) => f.key === key)?.maxLength ?? 0;
}

export const BIGSELLER_TITLE_SELECTORS = getFieldSelectors('title', 'bigseller');
export const BIGSELLER_DESCRIPTION_SELECTORS = getFieldSelectors(
  'description',
  'bigseller',
);
export const SHOPEE_TITLE_SELECTORS = getFieldSelectors('title', 'shopee');
export const SHOPEE_DESCRIPTION_SELECTORS = getFieldSelectors(
  'description',
  'shopee',
);

/** Shopee: vùng mô tả plain-text (.editor-outer) */
export const SHOPEE_DESCRIPTION_EDITOR_OUTER_SELECTORS = [
  '.editor-outer',
  '[data-product-edit-field-unique-id="description"] .editor-outer',
];

/** Shopee: container mô tả (rich-text / Quill fallback) */
export const SHOPEE_DESCRIPTION_CONTAINER_SELECTORS = [
  '[data-product-edit-field-unique-id="description"]',
  '.product-description-editor',
  '.product-description .rich-text-editor',
];

export const SHOPEE_DESCRIPTION_FALLBACK_SELECTORS = [
  '[data-product-edit-field-unique-id="description"] textarea',
  '[data-product-edit-field-unique-id="description"] .ql-editor',
  '.product-description-editor textarea',
  '.product-description-editor .ql-editor',
];
