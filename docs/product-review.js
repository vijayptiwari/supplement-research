import {escapeHtml as esc} from './presentation.js';

export const productReviewMarkup=r=>r.requiresProductReview===true?`<section class="method-card product-review"><h3>Separate product review required</h3><p>${esc(r.productReviewReason)}</p><p>This formulation is excluded from automatic stack suggestions. Its label and price remain available for comparison.</p></section>`:'';
