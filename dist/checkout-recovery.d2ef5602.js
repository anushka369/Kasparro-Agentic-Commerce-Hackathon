"use strict";var CheckoutRecovery=(()=>{var j=Object.defineProperty;var L=Object.getOwnPropertySymbols;var B=Object.prototype.hasOwnProperty,z=Object.prototype.propertyIsEnumerable;var U=(i,e,t)=>e in i?j(i,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):i[e]=t,C=(i,e)=>{for(var t in e||(e={}))B.call(e,t)&&U(i,t,e[t]);if(L)for(var t of L(e))z.call(e,t)&&U(i,t,e[t]);return i};function V(){if(typeof crypto!="undefined"&&typeof crypto.randomUUID=="function")return crypto.randomUUID();let i=new Uint8Array(16);if(typeof crypto!="undefined"&&typeof crypto.getRandomValues=="function")crypto.getRandomValues(i);else for(let t=0;t<16;t++)i[t]=Math.floor(Math.random()*256);i[6]=i[6]&15|64,i[8]=i[8]&63|128;let e=Array.from(i).map(t=>t.toString(16).padStart(2,"0"));return[e.slice(0,4).join(""),e.slice(4,6).join(""),e.slice(6,8).join(""),e.slice(8,10).join(""),e.slice(10,16).join("")].join("-")}var q=2,S=class{constructor(e,t="cart"){this.sessionId=V(),this.startedAt=Date.now(),this.cartId=e,this.checkoutStep=t,this.frictionEvents=[],this.interventions=[],this.converted=!1}addFrictionEvent(e){this.frictionEvents.push(e)}addIntervention(e){return this.interventions.length>=q||this.interventions.some(n=>n.category===e.category)?!1:(this.interventions.push(e),!0)}updateInterventionOutcome(e,t,n){let r=this.interventions.find(o=>o.interventionId===e);r!==void 0&&(r.outcome=t,n!==void 0&&(r.resolvedAt=n))}markConverted(){this.converted=!0,this.endedAt=Date.now()}end(){this.endedAt===void 0&&(this.endedAt=Date.now())}};var W=0,O=new WeakMap;function M(i){let e=i.id;if(e&&e.trim()!=="")return e;let t=O.get(i);if(t!==void 0)return t;let n=`__field_${++W}`;return O.set(i,n),n}function Y(){try{let i=document.querySelector("[data-checkout-step]");if(i!==null){let e=i.dataset.checkoutStep;if(Q(e))return e}}catch(i){}try{let i=window.location.pathname.toLowerCase();if(i.includes("/payment"))return"payment";if(i.includes("/shipping"))return"shipping";if(i.includes("/information"))return"information";if(i.includes("/review"))return"review";if(i.includes("/cart"))return"cart"}catch(i){}return"cart"}var X=["cart","information","shipping","payment","review"];function Q(i){return i!==void 0&&X.includes(i)}var _=class{constructor(e){this.pageLoadTime=Date.now();this.scrollDepthPct=0;this.velocitySamples=[];this.lastMouseX=0;this.lastMouseY=0;this.lastMouseTime=0;this.exitIntentDetected=!1;this.idleDetected=!1;this.idleTimer=null;this.backNavigationAttempted=!1;this.fieldEvents=[];this.focusTimes=new Map;this._fieldListeners=[];this.config=e,this._onMouseMove=t=>this._handleMouseMove(t),this._onScroll=()=>this._handleScroll(),this._onVisibilityChange=()=>this._handleVisibilityChange(),this._onBeforeUnload=()=>this._handleBeforeUnload(),this._onKeyDown=()=>this._resetIdleTimer(),this._onClick=()=>this._resetIdleTimer()}start(){try{document.addEventListener("mousemove",this._onMouseMove,{passive:!0})}catch(e){console.error("[SignalCollector] Failed to attach mousemove listener:",e)}try{document.addEventListener("scroll",this._onScroll,{passive:!0})}catch(e){console.error("[SignalCollector] Failed to attach scroll listener:",e)}try{document.addEventListener("visibilitychange",this._onVisibilityChange)}catch(e){console.error("[SignalCollector] Failed to attach visibilitychange listener:",e)}try{window.addEventListener("beforeunload",this._onBeforeUnload)}catch(e){console.error("[SignalCollector] Failed to attach beforeunload listener:",e)}try{document.addEventListener("keydown",this._onKeyDown,{passive:!0})}catch(e){console.error("[SignalCollector] Failed to attach keydown listener:",e)}try{document.addEventListener("click",this._onClick,{passive:!0})}catch(e){console.error("[SignalCollector] Failed to attach click listener:",e)}this._attachFieldListeners(),this._resetIdleTimer()}stop(){try{document.removeEventListener("mousemove",this._onMouseMove)}catch(e){console.error("[SignalCollector] Failed to remove mousemove listener:",e)}try{document.removeEventListener("scroll",this._onScroll)}catch(e){console.error("[SignalCollector] Failed to remove scroll listener:",e)}try{document.removeEventListener("visibilitychange",this._onVisibilityChange)}catch(e){console.error("[SignalCollector] Failed to remove visibilitychange listener:",e)}try{window.removeEventListener("beforeunload",this._onBeforeUnload)}catch(e){console.error("[SignalCollector] Failed to remove beforeunload listener:",e)}try{document.removeEventListener("keydown",this._onKeyDown)}catch(e){console.error("[SignalCollector] Failed to remove keydown listener:",e)}try{document.removeEventListener("click",this._onClick)}catch(e){console.error("[SignalCollector] Failed to remove click listener:",e)}for(let{el:e,type:t,handler:n}of this._fieldListeners)try{e.removeEventListener(t,n)}catch(r){console.error("[SignalCollector] Failed to remove field listener:",r)}this._fieldListeners.length=0,this.idleTimer!==null&&(clearTimeout(this.idleTimer),this.idleTimer=null)}getSnapshot(){return{timeOnPageMs:Date.now()-this.pageLoadTime,scrollDepthPct:this.scrollDepthPct,cursorVelocityAvg:this._computeVelocityAvg(),exitIntentDetected:this.exitIntentDetected,idleDetected:this.idleDetected,fieldEvents:[...this.fieldEvents],backNavigationAttempted:this.backNavigationAttempted,checkoutStep:Y()}}_handleMouseMove(e){try{let t=Date.now();if(this.lastMouseTime!==0){let n=e.clientX-this.lastMouseX,r=e.clientY-this.lastMouseY,o=t-this.lastMouseTime;if(o>0){let l=Math.sqrt(n*n+r*r)/o;this.velocitySamples.push(l),this.velocitySamples.length>10&&this.velocitySamples.shift()}}this.lastMouseX=e.clientX,this.lastMouseY=e.clientY,this.lastMouseTime=t,e.clientY<=this.config.exitIntentMarginPx&&(this.exitIntentDetected||(setTimeout(()=>{this.exitIntentDetected=!0},0),this.exitIntentDetected=!0)),this._resetIdleTimer()}catch(t){console.error("[SignalCollector] Error in mousemove handler:",t)}}_computeVelocityAvg(){return this.velocitySamples.length===0?0:this.velocitySamples.reduce((t,n)=>t+n,0)/this.velocitySamples.length}_handleScroll(){var e,t,n;try{let r=(n=(t=(e=window.scrollY)!=null?e:document.documentElement.scrollTop)!=null?t:document.body.scrollTop)!=null?n:0,o=document.documentElement.scrollHeight-document.documentElement.clientHeight;if(o>0){let s=Math.min(100,Math.max(0,r/o*100));s>this.scrollDepthPct&&(this.scrollDepthPct=s)}this._resetIdleTimer()}catch(r){console.error("[SignalCollector] Error in scroll handler:",r)}}_handleVisibilityChange(){try{document.visibilityState==="hidden"&&(this.backNavigationAttempted=!0)}catch(e){console.error("[SignalCollector] Error in visibilitychange handler:",e)}}_handleBeforeUnload(){try{this.backNavigationAttempted=!0}catch(e){console.error("[SignalCollector] Error in beforeunload handler:",e)}}_resetIdleTimer(){try{this.idleTimer!==null&&clearTimeout(this.idleTimer),this.idleDetected=!1,this.idleTimer=setTimeout(()=>{this.idleDetected=!0},this.config.idleTimeoutMs)}catch(e){console.error("[SignalCollector] Error resetting idle timer:",e)}}_attachFieldListeners(){try{let e=document.querySelectorAll("input, select, textarea");for(let t of e)this._addFieldListener(t,"focus",this._makeFieldFocusHandler(t)),this._addFieldListener(t,"blur",this._makeFieldBlurHandler(t)),this._addFieldListener(t,"change",this._makeFieldChangeHandler(t))}catch(e){console.error("[SignalCollector] Error attaching field listeners:",e)}}_addFieldListener(e,t,n){try{e.addEventListener(t,n),this._fieldListeners.push({el:e,type:t,handler:n})}catch(r){console.error(`[SignalCollector] Failed to attach ${t} listener on field:`,r)}}_makeFieldFocusHandler(e){return()=>{try{let t=M(e);this.focusTimes.set(t,Date.now()),this.fieldEvents.push({fieldId:t,eventType:"focus"}),this._resetIdleTimer()}catch(t){console.error("[SignalCollector] Error in field focus handler:",t)}}}_makeFieldBlurHandler(e){return()=>{try{let t=M(e),n=this.focusTimes.get(t),r=n!==void 0?Date.now()-n:void 0,o=r!==void 0?{fieldId:t,eventType:"blur",durationMs:r}:{fieldId:t,eventType:"blur"};this.fieldEvents.push(o),this.focusTimes.delete(t),this._checkFieldError(e,t),this._resetIdleTimer()}catch(t){console.error("[SignalCollector] Error in field blur handler:",t)}}}_makeFieldChangeHandler(e){return()=>{try{let t=M(e);this.fieldEvents.push({fieldId:t,eventType:"change"}),this._resetIdleTimer()}catch(t){console.error("[SignalCollector] Error in field change handler:",t)}}}_checkFieldError(e,t){var n;try{if(!(e.matches(":invalid")||e.getAttribute("aria-invalid")==="true"))return;let o;if("validationMessage"in e){let l=e.validationMessage;l&&l.trim()!==""&&(o=l)}if(o===void 0){let l=e.getAttribute("aria-errormessage");if(l){let c=document.getElementById(l);if(c!==null){let a=(n=c.textContent)==null?void 0:n.trim();a&&a!==""&&(o=a)}}}let s=o!==void 0?{fieldId:t,eventType:"error",errorMessage:o}:{fieldId:t,eventType:"error"};this.fieldEvents.push(s)}catch(r){console.error("[SignalCollector] Error checking field validation:",r)}}};var D=["Price_Hesitation","Shipping_Confusion","Trust_Issue","Missing_Information","Coupon_Confusion","Size_Uncertainty","Delivery_Timeline","Payment_Options"];var K=3e5,J=5,Z=10;function ee(i,e){switch(i){case"timeOnPageMs":return Math.min(1,e.timeOnPageMs/K);case"scrollDepthPct":return Math.min(1,e.scrollDepthPct/100);case"cursorVelocityAvg":return Math.min(1,e.cursorVelocityAvg/J);case"exitIntentDetected":return e.exitIntentDetected?1:0;case"idleDetected":return e.idleDetected?1:0;case"fieldEvents":return Math.min(1,e.fieldEvents.length/Z);case"backNavigationAttempted":return e.backNavigationAttempted?1:0;case"checkoutStep":return 0;default:return i}}function te(i,e){if(e===void 0)return 0;let t=0;for(let n of Object.keys(e)){if(n==="checkoutStep")continue;let r=e[n];r===void 0||r===0||(t+=ee(n,i)*r)}return t}function H(i,e){var a,d,p;let t={};for(let u of D)t[u]=te(i,e[u]);let n=Math.max(...Object.values(t)),r={};for(let u of D){let h=(a=t[u])!=null?a:0;r[u]=n>0?h/n:0}let o=Object.entries(r).sort(([,u],[,h])=>h-u),[s,l]=o[0],c=(p=(d=o[1])==null?void 0:d[1])!=null?p:0;return{category:s,confidence:l,isAmbiguous:l-c<.15,allScores:r}}var $={Price_Hesitation:{timeOnPageMs:.3,scrollDepthPct:.15,exitIntentDetected:.35,idleDetected:.2},Shipping_Confusion:{timeOnPageMs:.2,fieldEvents:.4,scrollDepthPct:.15,exitIntentDetected:.25},Trust_Issue:{scrollDepthPct:.25,exitIntentDetected:.35,idleDetected:.2,backNavigationAttempted:.2},Missing_Information:{fieldEvents:.6,timeOnPageMs:.2,idleDetected:.2},Coupon_Confusion:{fieldEvents:.5,timeOnPageMs:.25,idleDetected:.15,exitIntentDetected:.1},Size_Uncertainty:{scrollDepthPct:.3,idleDetected:.25,backNavigationAttempted:.3,timeOnPageMs:.15},Delivery_Timeline:{scrollDepthPct:.3,fieldEvents:.25,exitIntentDetected:.25,idleDetected:.2},Payment_Options:{exitIntentDetected:.35,fieldEvents:.3,idleDetected:.2,timeOnPageMs:.15}};var ne=500;function re(){return typeof globalThis!="undefined"&&typeof globalThis.LLM_GATEWAY_URL=="string"?globalThis.LLM_GATEWAY_URL:"/classify"}var E=class{constructor(e){this.handlers=[];this.collector=null;this.intervalHandle=null;this.emittedCategories=new Set;this.classifying=!1;this.config=null;this.sessionId=e}start(e){if(this.intervalHandle===null){this.config=e;try{this.collector=new _(e),this.collector.start()}catch(t){console.error("[FrictionDetector] Failed to start SignalCollector:",t)}this.intervalHandle=setInterval(()=>{this._runClassificationCycle()},ne)}}stop(){if(this.intervalHandle!==null&&(clearInterval(this.intervalHandle),this.intervalHandle=null),this.collector!==null){try{this.collector.stop()}catch(e){console.error("[FrictionDetector] Error stopping SignalCollector:",e)}this.collector=null}this.config=null,this.classifying=!1}onFrictionEvent(e){this.handlers.push(e)}async _runClassificationCycle(){if(this.classifying||this.config===null||this.collector===null)return;this.classifying=!0;let e=new AbortController,t=setTimeout(()=>e.abort(),this.config.classificationTimeoutMs);try{await this._classify(this.config,e.signal)}catch(n){n instanceof Error&&n.name==="AbortError"?console.warn("[FrictionDetector] Classification cycle timed out"):console.error("[FrictionDetector] Unexpected error in classification cycle:",n)}finally{clearTimeout(t),this.classifying=!1}}async _classify(e,t){if(t.aborted)return;let n;try{n=this.collector.getSnapshot()}catch(a){console.error("[FrictionDetector] Failed to get signal snapshot:",a);return}let r;try{r=H(n,$)}catch(a){console.error("[FrictionDetector] Deterministic classification failed:",a);return}let{category:o,confidence:s,isAmbiguous:l,allScores:c}=r;if(!t.aborted){if(!l&&s>=e.confidenceThreshold){this._maybeEmit(o,s,n);return}if(l){let a=this._topTwoCategories(c),d=await this._callLlmGateway(n,a,t);if(t.aborted)return;if(d!==null&&d.category!==null&&d.confidence>=e.confidenceThreshold){this._maybeEmit(d.category,d.confidence,n);return}s>=e.confidenceThreshold&&this._maybeEmit(o,s,n)}}}async _callLlmGateway(e,t,n){try{let r=re(),o=await fetch(r,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({signals:e,topTwoCategories:t}),signal:n});if(!o.ok)return console.warn(`[FrictionDetector] LLM Gateway returned HTTP ${o.status}`),null;let s=await o.json();return this._parseLlmResponse(s)}catch(r){return r instanceof Error&&r.name==="AbortError"?console.warn("[FrictionDetector] LLM Gateway call timed out"):console.error("[FrictionDetector] LLM Gateway call failed:",r),null}}_parseLlmResponse(e){if(typeof e!="object"||e===null)return null;let t=e,n=t.category;if(n!==null&&typeof n!="string")return null;let r=t.confidence;return typeof r!="number"?null:typeof t.reasoning=="string"?{category:n,confidence:r,reasoning:t.reasoning}:{category:n,confidence:r}}_maybeEmit(e,t,n){if(this.emittedCategories.has(e))return;this.emittedCategories.add(e);let r={sessionId:this.sessionId,category:e,confidence:t,signals:n,detectedAt:Date.now()};this._dispatchEvent(r)}_dispatchEvent(e){for(let t of this.handlers)try{t(e)}catch(n){console.error("[FrictionDetector] Error in FrictionEvent handler:",n)}}_topTwoCategories(e){var o,s,l,c;let t=Object.entries(e).sort(([,a],[,d])=>d-a),n=(s=(o=t[0])==null?void 0:o[0])!=null?s:"",r=(c=(l=t[1])==null?void 0:l[0])!=null?c:"";return[n,r]}};var ie=["input[required]","select[required]","textarea[required]",'[aria-required="true"]'].join(", "),oe=["error","invalid","validation"],I=class{scan(e){let t=[],n=null;try{n=e!=null?e:document.body}catch(o){return t}if(n===null)return t;let r;try{r=n.querySelectorAll(ie)}catch(o){return t}for(let o of r)try{let s=o;if(!this._isMissing(s))continue;let l=this._resolveFieldId(s),c=this._resolveLabel(s,n),a=this._resolveErrorMessage(s,n),d=a!==void 0?{fieldId:l,label:c,errorMessage:a}:{fieldId:l,label:c};t.push(d)}catch(s){continue}return t}_isMissing(e){var t,n;try{if(e.getAttribute("aria-invalid")==="true")return!0}catch(r){}try{if(e.matches(":invalid"))return!0}catch(r){}try{let r=e.getAttribute("aria-describedby");if(r!==null)for(let o of r.trim().split(/\s+/)){if(o==="")continue;let s=document.getElementById(o);if(s!==null&&((n=(t=s.textContent)==null?void 0:t.trim())!=null?n:"")!=="")return!0}}catch(r){}try{if(this._findNearbyErrorElement(e)!==null)return!0}catch(r){}try{let r=e.tagName.toLowerCase();if((r==="input"||r==="textarea"||r==="select")&&e.value.trim()==="")return!0}catch(r){}return!1}_resolveFieldId(e){try{let t=e.id;if(t&&t.trim()!=="")return t}catch(t){}try{let t=e.name;if(t&&t.trim()!=="")return t}catch(t){}return"__missing_field__"}_resolveLabel(e,t){var n,r,o,s,l,c;try{let a=e.id;if(a&&a.trim()!==""){let d=t.querySelector(`label[for="${CSS.escape(a)}"]`);if(d!==null){let p=(r=(n=d.textContent)==null?void 0:n.trim())!=null?r:"";if(p!=="")return p}}}catch(a){try{let d=e.id;if(d&&d.trim()!==""){let p=t.querySelector(`label[for="${d}"]`);if(p!==null){let u=(s=(o=p.textContent)==null?void 0:o.trim())!=null?s:"";if(u!=="")return u}}}catch(d){}}try{let a=e.getAttribute("aria-label");if(a!==null&&a.trim()!=="")return a.trim()}catch(a){}try{let a=e.getAttribute("aria-labelledby");if(a!==null&&a.trim()!==""){let d=[];for(let p of a.trim().split(/\s+/)){if(p==="")continue;let u=document.getElementById(p);if(u!==null){let h=(c=(l=u.textContent)==null?void 0:l.trim())!=null?c:"";h!==""&&d.push(h)}}if(d.length>0)return d.join(" ")}}catch(a){}try{let a=e.placeholder;if(a&&a.trim()!=="")return a.trim()}catch(a){}try{let a=e.name;if(a&&a.trim()!=="")return a.trim()}catch(a){}try{let a=e.id;if(a&&a.trim()!=="")return a.trim()}catch(a){}return"Unknown field"}_resolveErrorMessage(e,t){var n,r,o,s;try{let l=e.getAttribute("aria-describedby");if(l!==null){let c=[];for(let a of l.trim().split(/\s+/)){if(a==="")continue;let d=document.getElementById(a);if(d!==null){let p=(r=(n=d.textContent)==null?void 0:n.trim())!=null?r:"";p!==""&&c.push(p)}}if(c.length>0)return c.join(" ")}}catch(l){}try{let l=this._findNearbyErrorElement(e);if(l!==null){let c=(s=(o=l.textContent)==null?void 0:o.trim())!=null?s:"";if(c!=="")return c}}catch(l){}try{if("validationMessage"in e){let l=e.validationMessage;if(l&&l.trim()!=="")return l.trim()}}catch(l){}}_findNearbyErrorElement(e){try{let t=e.nextElementSibling;if(t!==null&&this._hasErrorClass(t))return t}catch(t){}try{let t=e.previousElementSibling;if(t!==null&&this._hasErrorClass(t))return t}catch(t){}try{let t=e.parentElement;if(t!==null){for(let n of t.children)if(n!==e&&this._hasErrorClass(n))return n}}catch(t){}try{for(let t of e.children)if(this._hasErrorClass(t))return t}catch(t){}return null}_hasErrorClass(e){try{let t=typeof e.className=="string"?e.className.toLowerCase():"";return oe.some(n=>t.includes(n))}catch(t){return!1}}};var se=2,ae=3e3,ce=3e3;function le(){if(typeof crypto!="undefined"&&typeof crypto.randomUUID=="function")return crypto.randomUUID();let i=new Uint8Array(16);if(typeof crypto!="undefined"&&typeof crypto.getRandomValues=="function")crypto.getRandomValues(i);else for(let t=0;t<16;t++)i[t]=Math.floor(Math.random()*256);i[6]=i[6]&15|64,i[8]=i[8]&63|128;let e=Array.from(i).map(t=>t.toString(16).padStart(2,"0"));return[e.slice(0,4).join(""),e.slice(4,6).join(""),e.slice(6,8).join(""),e.slice(8,10).join(""),e.slice(10,16).join("")].join("-")}function de(i){if(i.length>0){let e=i.reduce((n,r)=>r.discountAmount>n.discountAmount?r:n),t=[];return e.couponCode!==void 0&&t.push({label:`Apply ${e.couponCode}`,actionType:"apply_coupon",payload:{couponCode:e.couponCode,offerId:e.offerId}}),t.push({label:"No thanks",actionType:"dismiss"}),{headline:"Here's a deal for you",body:`${e.title} \u2014 ${e.description}`,actions:t,supplementalData:{offers:i}}}return{headline:"Great value in your cart",body:"You're getting a competitive price. Here's a quick summary of what makes this a great deal.",actions:[{label:"See price breakdown",actionType:"expand_detail"},{label:"Continue to checkout",actionType:"dismiss"}],supplementalData:{offers:[]}}}function ue(i){let e=i.map(t=>({label:`${t.title} \u2014 ${t.currencyCode} ${t.price.toFixed(2)}${t.deliveryEstimate!==void 0?` (${t.deliveryEstimate})`:""}`,actionType:"select_shipping",payload:{handle:t.handle}}));return e.push({label:"Dismiss",actionType:"dismiss"}),{headline:"Shipping options for your order",body:"Choose the shipping speed that works best for you:",actions:e,supplementalData:{shippingOptions:i}}}function pe(i){let e=i.map(t=>({label:`${t.title}${t.deliveryEstimate!==void 0?` \u2014 ${t.deliveryEstimate}`:""}`,actionType:"select_shipping",payload:{handle:t.handle}}));return e.push({label:"Dismiss",actionType:"dismiss"}),{headline:"Estimated delivery for your order",body:"Here are the available delivery options with estimated arrival times:",actions:e,supplementalData:{shippingOptions:i}}}function he(){return{headline:"Shop with confidence",body:"Your order is protected by our secure checkout, easy returns, and verified customer reviews.",actions:[{label:"View return policy",actionType:"expand_detail",payload:{section:"return_policy"}},{label:"See security details",actionType:"expand_detail",payload:{section:"security"}},{label:"Read reviews",actionType:"expand_detail",payload:{section:"reviews"}},{label:"Continue to checkout",actionType:"dismiss"}],supplementalData:{trustSignals:[{type:"return_policy",label:"30-day hassle-free returns"},{type:"security",label:"SSL-encrypted checkout"},{type:"reviews",label:"Verified customer reviews"}]}}}function me(i){let e=Object.values(i.inventory).filter(n=>n.available).map(n=>({label:n.size,variantId:n.variantId})),t=e.map(n=>({label:n.label,actionType:"select_variant",payload:{variantId:n.variantId}}));return t.push({label:"See full size guide",actionType:"expand_detail",payload:{guideUrl:i.guideUrl}}),t.push({label:"Dismiss",actionType:"dismiss"}),{headline:`Find your size \u2014 ${i.productTitle}`,body:"Select your size below. In-stock sizes are shown.",actions:t,supplementalData:{sizeGuide:i,availableSizes:e}}}function fe(i){let t=i.filter(n=>n.available).map(n=>({label:n.name,actionType:"select_payment",payload:{methodId:n.methodId}}));return t.push({label:"Dismiss",actionType:"dismiss"}),{headline:"Payment options available",body:"We accept the following payment methods \u2014 choose the one that works for you:",actions:t,supplementalData:{paymentMethods:i}}}function ye(i){let e=i.length;return{headline:"Let's finish your order",body:`${e} required ${e===1?"field needs":"fields need"} attention before you can proceed.`,actions:[{label:"Show me what's missing",actionType:"expand_detail",payload:{section:"missing_fields"}},{label:"Dismiss",actionType:"dismiss"}],supplementalData:{missingFields:i}}}function ge(i){if(i.length>0){let e=i.filter(t=>t.couponCode!==void 0).map(t=>({label:`Apply ${t.couponCode}`,actionType:"apply_coupon",payload:{couponCode:t.couponCode,offerId:t.offerId}}));return e.push({label:"Dismiss",actionType:"dismiss"}),{headline:"Having trouble with a coupon?",body:"Here are the available discount codes for your cart:",actions:e,supplementalData:{offers:i}}}return{headline:"No active coupon codes",body:"There are no coupon codes available for your current cart. You can continue to checkout at the regular price.",actions:[{label:"Continue to checkout",actionType:"dismiss"}],supplementalData:{offers:[]}}}var A=class{constructor(e,t){this.adapter=e,this.breaker=t}async resolve(e,t){if(t.interventions.length>=se||t.interventions.some(s=>s.category===e.category))return null;let r=new AbortController,o=setTimeout(()=>r.abort(),ae);try{return await this._resolveWithSignal(e,t,r.signal)}catch(s){return s instanceof Error&&s.name==="AbortError"?console.warn("[InterventionEngine] Resolution timed out for category:",e.category):console.error("[InterventionEngine] Unexpected error during resolution:",s),null}finally{clearTimeout(o)}}async _resolveWithSignal(e,t,n){if(n.aborted)return null;let r=e.category,o=null,s;try{switch(r){case"Price_Hesitation":{let c=await this._callAdapter(()=>this.adapter.getApplicableOffers(t.cartId),n);if(c===null)return null;s=c.length>0?"show_coupon":"show_price_comparison",o=de(c);break}case"Shipping_Confusion":{let c=await this._callAdapter(()=>this.adapter.getShippingOptions(t.cartId,this._extractPostalCode(t)),n);if(c===null||c.length===0)return null;let a=this._sortShippingOptions(c);s="show_shipping_options",o=ue(a);break}case"Delivery_Timeline":{let c=await this._callAdapter(()=>this.adapter.getShippingOptions(t.cartId,this._extractPostalCode(t)),n);if(c===null||c.length===0)return null;let a=this._sortShippingOptions(c);s="show_delivery_estimate",o=pe(a);break}case"Trust_Issue":{if(n.aborted)return null;s="show_trust_signals",o=he();break}case"Size_Uncertainty":{let c=this._extractProductId(t);if(c===null)return null;let a=await this._callAdapter(()=>this.adapter.getSizeGuide(c),n);if(a===null||!Object.values(a.inventory).some(p=>p.available))return null;s="show_size_guide",o=me(a);break}case"Payment_Options":{let c=await this._callAdapter(()=>this.adapter.getPaymentMethods(t.cartId),n);if(c===null||c.length===0||c.filter(d=>d.available).length===0)return null;s="show_payment_options",o=fe(c);break}case"Missing_Information":{if(n.aborted)return null;let a=new I().scan();if(a.length===0)return null;s="highlight_missing_fields",o=ye(a);break}case"Coupon_Confusion":{let c=await this._callAdapter(()=>this.adapter.getApplicableOffers(t.cartId),n);if(c===null)return null;s="show_coupon",o=ge(c);break}default:return console.warn("[InterventionEngine] Unknown category:",r),null}}catch(c){if(c instanceof Error&&c.name==="AbortError")throw c;return console.error("[InterventionEngine] Adapter call failed:",c),null}return o===null||n.aborted?null:{interventionId:le(),category:r,recoveryAction:s,content:o,expiresAt:Date.now()+ce}}async _callAdapter(e,t){if(t.aborted)return null;try{return await this.breaker.call(e)}catch(n){if(n instanceof Error&&n.name==="AbortError")throw n;return console.warn("[InterventionEngine] Adapter call suppressed by circuit breaker or error:",n),null}}_extractPostalCode(e){let t=e.frictionEvents[e.frictionEvents.length-1];if(t===void 0)return"";let n=t.signals.fieldEvents.find(r=>r.fieldId.toLowerCase().includes("postal")||r.fieldId.toLowerCase().includes("zip")||r.fieldId.toLowerCase().includes("postcode"));return""}_extractProductId(e){return e.cartId===""?null:e.cartId}_sortShippingOptions(e){return[...e].sort((t,n)=>{var s,l;let r=(s=t.minDeliveryDays)!=null?s:Number.MAX_SAFE_INTEGER,o=(l=n.minDeliveryDays)!=null?l:Number.MAX_SAFE_INTEGER;return r-o})}};var w=class{constructor(){this.state={status:"closed",failureCount:0,lastFailureAt:0,nextRetryAt:0}}getState(){return C({},this.state)}async call(e){let t=Date.now();if(this.state.status==="open"){if(t<this.state.nextRetryAt)throw new Error(`Circuit breaker is open. Calls suppressed until ${new Date(this.state.nextRetryAt).toISOString()}.`);this.state.status="half-open"}try{let n=await e();return this.onSuccess(),n}catch(n){throw this.onFailure(t),n}}onSuccess(){this.state.status="closed",this.state.failureCount=0,this.state.lastFailureAt=0,this.state.nextRetryAt=0}onFailure(e){this.state.lastFailureAt>0&&e-this.state.lastFailureAt>6e4&&(this.state.failureCount=0),this.state.failureCount+=1,this.state.lastFailureAt=e,this.state.failureCount>=3&&(this.state.status="open",this.state.nextRetryAt=e+3e4)}};var N="acr-widget-styles",ve=`
/* AI Checkout Recovery \u2014 Conversation Widget */
#acr-widget-root {
  position: fixed;
  z-index: 2147483647; /* max z-index */
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a1a;
  pointer-events: none; /* root is transparent; only widget panel captures events */
}

.acr-widget-panel {
  pointer-events: all;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  padding: 16px;
  max-width: 360px;
  min-width: 280px;
  width: calc(100vw - 32px);
  box-sizing: border-box;
  animation: acr-slide-in 0.2s ease-out;
}

@keyframes acr-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.acr-widget-headline {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 8px 0;
  padding-right: 24px; /* space for close button */
}

.acr-widget-body {
  font-size: 13px;
  color: #555555;
  margin: 0 0 12px 0;
}

.acr-widget-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acr-action-btn {
  display: block;
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid #d0d0d0;
  background: #f7f7f7;
  color: #1a1a1a;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
  box-sizing: border-box;
}

.acr-action-btn:hover {
  background: #efefef;
  border-color: #b0b0b0;
}

.acr-action-btn:focus-visible {
  outline: 2px solid #0070f3;
  outline-offset: 2px;
}

.acr-action-btn--primary {
  background: #0070f3;
  border-color: #0070f3;
  color: #ffffff;
}

.acr-action-btn--primary:hover {
  background: #005fd1;
  border-color: #005fd1;
}

.acr-action-btn--dismiss {
  background: transparent;
  border-color: transparent;
  color: #888888;
  font-size: 12px;
  padding: 6px 14px;
}

.acr-action-btn--dismiss:hover {
  color: #555555;
  background: transparent;
}

.acr-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #888888;
  font-size: 18px;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.acr-close-btn:hover {
  color: #333333;
  background: #f0f0f0;
}

.acr-close-btn:focus-visible {
  outline: 2px solid #0070f3;
  outline-offset: 2px;
}

/* Responsive: narrow viewports (320px \u2013 480px) */
@media (max-width: 480px) {
  .acr-widget-panel {
    border-radius: 8px;
    padding: 12px;
  }
}

/* Responsive: wide viewports (> 768px) \u2014 anchor to bottom-right */
@media (min-width: 769px) {
  .acr-widget-panel {
    width: 360px;
  }
}
`;function be(i){let e=window.innerWidth,t=window.innerHeight,n=Array.from(i.querySelectorAll('input, select, textarea, [role="textbox"], [role="combobox"]')).filter(d=>{let p=d.getBoundingClientRect();return p.width>0&&p.height>0}),r=0,o=0;for(let d of n){let p=d.getBoundingClientRect();p.top<t/2?r=Math.max(r,p.bottom):o=Math.max(o,t-p.top)}let s=r,l=o,c=220,a=16;return t-l-a>=c?{bottom:`${l+a}px`,right:`${a}px`}:s+a+c<=t?{top:`${s+a}px`,right:`${a}px`}:{bottom:`${a}px`,right:`${a}px`}}function Ce(){if(document.getElementById(N)!==null)return;let i=document.createElement("style");i.id=N,i.textContent=ve,document.head.appendChild(i)}var T=class{constructor(e){this.rootEl=null;this.container=null;this.activePayload=null;this.actionHandlers=[];this.expiryTimerId=null;this.session=e}mount(e){if(this.container=e,Ce(),this.rootEl===null){let t=document.createElement("div");t.id="acr-widget-root",t.setAttribute("role","complementary"),t.setAttribute("aria-label","Checkout assistance"),this.rootEl=t}e.appendChild(this.rootEl)}show(e){try{this._show(e)}catch(t){console.error("[ConversationManager] Render error suppressed:",t),this.dismiss("engine_error")}}dismiss(e){if(this._clearExpiryTimer(),this.activePayload!==null){let t=Se(e);this.session.updateInterventionOutcome(this.activePayload.interventionId,t,Date.now()),this.activePayload=null}this.rootEl!==null&&(this.rootEl.innerHTML="")}onAction(e){this.actionHandlers.push(e)}_show(e){var o;if(this.rootEl===null)throw new Error("[ConversationManager] mount() must be called before show()");this.activePayload!==null&&this.dismiss("step_completed"),this.activePayload=e,this.session.addIntervention({interventionId:e.interventionId,category:e.category,triggeredAt:Date.now(),outcome:"pending"});let t=be((o=this.container)!=null?o:document.body);Object.assign(this.rootEl.style,C({top:"",bottom:"",left:"",right:""},t));let n=this._buildPanel(e);this.rootEl.innerHTML="",this.rootEl.appendChild(n);let r=e.expiresAt-Date.now();r>0?this.expiryTimerId=setTimeout(()=>{this.dismiss("timeout")},r):this.dismiss("timeout")}_buildPanel(e){let t=document.createElement("div");t.className="acr-widget-panel",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","false"),t.setAttribute("aria-labelledby","acr-headline"),t.style.position="relative";let n=document.createElement("button");n.className="acr-close-btn",n.setAttribute("aria-label","Dismiss"),n.textContent="\xD7",n.addEventListener("click",()=>{this._handleAction(e,{label:"Dismiss",actionType:"dismiss"})}),t.appendChild(n);let r=document.createElement("p");r.id="acr-headline",r.className="acr-widget-headline",r.textContent=e.content.headline,t.appendChild(r);let o=document.createElement("p");o.className="acr-widget-body",o.textContent=e.content.body,t.appendChild(o);let s=document.createElement("div");return s.className="acr-widget-actions",e.content.actions.forEach((l,c)=>{let a=this._buildActionButton(l,c===0,e);s.appendChild(a)}),t.appendChild(s),t}_buildActionButton(e,t,n){let r=document.createElement("button");return r.type="button",r.textContent=e.label,e.actionType==="dismiss"?r.className="acr-action-btn acr-action-btn--dismiss":t?r.className="acr-action-btn acr-action-btn--primary":r.className="acr-action-btn",r.addEventListener("click",()=>{this._handleAction(n,e)}),r}_handleAction(e,t){let n={interventionId:e.interventionId,actionType:t.actionType,payload:t.payload,timestamp:Date.now()};t.actionType==="dismiss"&&this.dismiss("user_dismissed"),requestAnimationFrame(()=>{this._dispatchActionAsync(n)})}async _dispatchActionAsync(e){for(let t of this.actionHandlers)try{await Promise.resolve(t(e))}catch(n){console.error("[ConversationManager] Action handler error suppressed:",n)}}_clearExpiryTimer(){this.expiryTimerId!==null&&(clearTimeout(this.expiryTimerId),this.expiryTimerId=null)}};function Se(i){switch(i){case"user_dismissed":return"dismissed";case"step_completed":return"dismissed";case"timeout":return"timed_out";case"engine_error":return"dismissed";default:{let e=i;return"dismissed"}}}var _e={Price_Hesitation:"show_coupon",Shipping_Confusion:"show_shipping_options",Trust_Issue:"show_trust_signals",Missing_Information:"highlight_missing_fields",Coupon_Confusion:"show_coupon",Size_Uncertainty:"show_size_guide",Delivery_Timeline:"show_delivery_estimate",Payment_Options:"show_payment_options"};function Ee(i,e){var n;let t=(n=i.endedAt)!=null?n:Date.now();return{sessionId:i.sessionId,platformId:e,startedAt:new Date(i.startedAt).toISOString(),endedAt:new Date(t).toISOString(),checkoutStepReached:i.checkoutStep,frictionEvents:i.frictionEvents.map(r=>({category:r.category,confidence:r.confidence,detectedAt:new Date(r.detectedAt).toISOString()})),interventions:i.interventions.map(r=>({interventionId:r.interventionId,category:r.category,recoveryAction:_e[r.category],triggeredAt:new Date(r.triggeredAt).toISOString(),outcome:r.outcome==="pending"?"timed_out":r.outcome})),converted:i.converted}}var k=class{constructor(e){this.analyticsServiceUrl=e.analyticsServiceUrl,this.platformId=e.platformId}flush(e){e.end();let t=Ee(e,this.platformId),n=`${this.analyticsServiceUrl}/session`,r=JSON.stringify(t);typeof navigator!="undefined"&&typeof navigator.sendBeacon=="function"&&navigator.sendBeacon(n,new Blob([r],{type:"application/json"}))||this.sendWithRetry(n,r)}sendWithRetry(e,t){this.sendFetch(e,t).catch(()=>{setTimeout(()=>{this.sendFetch(e,t).catch(n=>{console.error("[AnalyticsClient] Failed to send session record after retry:",n)})},1e3)})}async sendFetch(e,t){let n=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:t});if(!n.ok)throw new Error(`[AnalyticsClient] HTTP ${n.status} from ${e}`)}};var v=class extends Error{constructor(e,t,n){super(e),this.name="PlatformError",this.statusCode=t,this.code=n}},x=class{constructor(e){this.config=e}get storefrontUrl(){return`https://${this.config.shopDomain}/api/${this.config.apiVersion}/graphql.json`}get adminBaseUrl(){return`https://${this.config.shopDomain}/admin/api/${this.config.apiVersion}`}async storefrontQuery(e,t={}){let n=await fetch(this.storefrontUrl,{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Storefront-Access-Token":this.config.storefrontAccessToken},body:JSON.stringify({query:e,variables:t})});if(!n.ok)throw new v(`Storefront API request failed: ${n.statusText}`,n.status,"STOREFRONT_API_ERROR");let r=await n.json();if(r.errors!==void 0&&r.errors.length>0){let o=r.errors[0];throw new v(o!==void 0?o.message:"GraphQL error",422,"GRAPHQL_ERROR")}return r.data}async adminGet(e){let t=`${this.adminBaseUrl}${e}`,n=await fetch(t,{method:"GET",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":this.config.adminAccessToken}});if(!n.ok)throw new v(`Admin API request failed: ${n.statusText}`,n.status,"ADMIN_API_ERROR");return n.json()}async getApplicableOffers(e){let t=await this.adminGet("/price_rules.json?status=enabled&limit=250"),n=new Date,r=t.price_rules.filter(c=>{let a=c.starts_at!==null?new Date(c.starts_at):null,d=c.ends_at!==null?new Date(c.ends_at):null,p=a===null||a<=n,u=d===null||d>n;return p&&u});if(r.length===0)return[];let o=r.slice(0,10),s=await Promise.allSettled(o.map(c=>this.adminGet(`/price_rules/${c.id}/discount_codes.json`))),l=[];for(let c=0;c<o.length;c++){let a=o[c],d=s[c];if(a===void 0||d===void 0||d.status!=="fulfilled")continue;let p=d.value.discount_codes;if(p.length===0)continue;let u=p[0];if(u===void 0)continue;let h=a.value_type==="percentage"?Math.abs(parseFloat(a.value))/100:Math.abs(parseFloat(a.value)),m={offerId:String(a.id),title:a.title,description:a.value_type==="percentage"?`${Math.abs(parseFloat(a.value))}% off`:`$${Math.abs(parseFloat(a.value)).toFixed(2)} off`,couponCode:u.code,discountAmount:h,discountType:a.value_type==="percentage"?"percentage":"fixed"};a.ends_at!==null&&(m.expiresAt=a.ends_at),l.push(m)}return l}async getShippingOptions(e,t){var c,a,d;let n=`
      query GetShippingRates($postalCode: String!) {
        shop {
          shipsToCountries
        }
      }
    `;return((d=(a=(c=(await this.storefrontQuery(`
      query GetCheckoutShippingRates($checkoutId: ID!) {
        node(id: $checkoutId) {
          ... on Checkout {
            availableShippingRates {
              ready
              shippingRates {
                handle
                title
                priceV2 {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `,{checkoutId:e})).node)==null?void 0:c.availableShippingRates)==null?void 0:a.shippingRates)!=null?d:[]).map(p=>{var y,b;let u=(y=p.deliveryRange)==null?void 0:y.minDays,h=(b=p.deliveryRange)==null?void 0:b.maxDays,m;u!==void 0&&h!==void 0?m=`${u}\u2013${h} business days`:u!==void 0&&(m=`${u}+ business days`);let f={handle:p.handle,title:p.title,price:parseFloat(p.priceV2.amount),currencyCode:p.priceV2.currencyCode};return u!==void 0&&(f.minDeliveryDays=u),h!==void 0&&(f.maxDeliveryDays=h),m!==void 0&&(f.deliveryEstimate=m),f}).sort((p,u)=>{var f,y;let h=(f=p.minDeliveryDays)!=null?f:Number.MAX_SAFE_INTEGER,m=(y=u.minDeliveryDays)!=null?y:Number.MAX_SAFE_INTEGER;return h-m})}async getSizeGuide(e){var p;let n=await this.storefrontQuery(`
      query GetSizeGuide($productId: ID!) {
        product(id: $productId) {
          id
          title
          metafields(identifiers: [
            { namespace: "size_guide", key: "entries" },
            { namespace: "size_guide", key: "guide_url" }
          ]) {
            namespace
            key
            value
          }
          variants(first: 50) {
            edges {
              node {
                id
                title
                availableForSale
                quantityAvailable
              }
            }
          }
        }
      }
    `,{productId:e});if(n.product===null)throw new v(`Product not found: ${e}`,404,"PRODUCT_NOT_FOUND");let r=n.product,o=r.metafields.filter(u=>u!==null),s=o.find(u=>u.namespace==="size_guide"&&u.key==="entries"),l=o.find(u=>u.namespace==="size_guide"&&u.key==="guide_url"),c=[];if(s!==void 0)try{let u=JSON.parse(s.value);Array.isArray(u)&&(c=u)}catch(u){c=[]}let a={};for(let u of r.variants.edges){let h=u.node;a[h.id]={variantId:h.id,size:h.title,available:h.availableForSale,quantityAvailable:(p=h.quantityAvailable)!=null?p:0}}let d={productId:r.id,productTitle:r.title,entries:c,inventory:a};return(l==null?void 0:l.value)!==void 0&&(d.guideUrl=l.value),d}async getPaymentMethods(e){let t=`
      query GetPaymentGateways {
        shop {
          paymentSettings {
            acceptedCardBrands
            enabledPresentmentCurrencies
          }
        }
        checkout: node(id: $checkoutId) {
          ... on Checkout {
            availableShippingRates {
              ready
            }
          }
        }
      }
    `,s=(await this.storefrontQuery(`
      query GetPaymentGateways {
        shop {
          paymentSettings {
            acceptedCardBrands
          }
        }
      }
    `)).shop.paymentSettings.acceptedCardBrands.map(c=>({methodId:c.toLowerCase().replace(/\s+/g,"_"),name:c,type:"card",available:!0})),l=[{methodId:"shop_pay",name:"Shop Pay",type:"digital_wallet",available:!0},{methodId:"paypal",name:"PayPal",type:"digital_wallet",available:!0},{methodId:"apple_pay",name:"Apple Pay",type:"digital_wallet",available:!0},{methodId:"google_pay",name:"Google Pay",type:"digital_wallet",available:!0}];return[...s,...l]}async applyCoupon(e,t){let o=(await this.storefrontQuery(`
      mutation CartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
        cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
          cart {
            id
            discountCodes {
              code
              applicable
            }
            cost {
              totalAmount {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,{cartId:e,discountCodes:[t]})).cartDiscountCodesUpdate;if(o.userErrors.length>0){let l=o.userErrors[0];return{success:!1,errorMessage:l!==void 0?l.message:"Unknown error",userErrors:o.userErrors}}if(o.cart===null)return{success:!1,errorMessage:"Cart not found"};let s=o.cart.discountCodes.find(l=>l.code.toLowerCase()===t.toLowerCase());return s!==void 0&&!s.applicable?{success:!1,errorMessage:`Discount code "${t}" is not applicable to this cart`,userErrors:[]}:{success:!0,cartTotal:parseFloat(o.cart.cost.totalAmount.amount),currencyCode:o.cart.cost.totalAmount.currencyCode}}async selectShipping(e,t){let o=(await this.storefrontQuery(`
      mutation CheckoutShippingLineUpdate($checkoutId: ID!, $shippingRateHandle: String!) {
        checkoutShippingLineUpdate(checkoutId: $checkoutId, shippingRateHandle: $shippingRateHandle) {
          checkout {
            id
            totalPriceV2 {
              amount
              currencyCode
            }
          }
          checkoutUserErrors {
            field
            message
          }
        }
      }
    `,{checkoutId:e,shippingRateHandle:t})).checkoutShippingLineUpdate;if(o.checkoutUserErrors.length>0){let s=o.checkoutUserErrors[0];return{success:!1,errorMessage:s!==void 0?s.message:"Unknown error",userErrors:o.checkoutUserErrors}}return o.checkout===null?{success:!1,errorMessage:"Checkout not found"}:{success:!0,cartTotal:parseFloat(o.checkout.totalPriceV2.amount),currencyCode:o.checkout.totalPriceV2.currencyCode}}async updateVariant(e,t,n){let s=(await this.storefrontQuery(`
      mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) {
          cart {
            id
            cost {
              totalAmount {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,{cartId:e,lines:[{id:t,merchandiseId:n}]})).cartLinesUpdate;if(s.userErrors.length>0){let l=s.userErrors[0];return{success:!1,errorMessage:l!==void 0?l.message:"Unknown error",userErrors:s.userErrors}}return s.cart===null?{success:!1,errorMessage:"Cart not found"}:{success:!0,cartTotal:parseFloat(s.cart.cost.totalAmount.amount),currencyCode:s.cart.cost.totalAmount.currencyCode}}async selectPaymentMethod(e,t){let o=(await this.storefrontQuery(`
      mutation CheckoutAttributesUpdate($checkoutId: ID!, $input: CheckoutAttributesUpdateV2Input!) {
        checkoutAttributesUpdateV2(checkoutId: $checkoutId, input: $input) {
          checkout {
            id
            totalPriceV2 {
              amount
              currencyCode
            }
          }
          checkoutUserErrors {
            field
            message
          }
        }
      }
    `,{checkoutId:e,input:{customAttributes:[{key:"selected_payment_method",value:t}]}})).checkoutAttributesUpdateV2;if(o.checkoutUserErrors.length>0){let s=o.checkoutUserErrors[0];return{success:!1,errorMessage:s!==void 0?s.message:"Unknown error",userErrors:o.checkoutUserErrors}}return o.checkout===null?{success:!1,errorMessage:"Checkout not found"}:{success:!0,cartTotal:parseFloat(o.checkout.totalPriceV2.amount),currencyCode:o.checkout.totalPriceV2.currencyCode}}};function Ie(){try{let i=globalThis;if(typeof i.CheckoutRecoveryConfig=="object"&&i.CheckoutRecoveryConfig!==null)return i.CheckoutRecoveryConfig}catch(i){}return{}}function Ae(i){if(i.cartId!==void 0&&i.cartId!=="")return i.cartId;try{let e=globalThis,t=e.Shopify;if(t!==void 0){let r=t.checkout;if(r!==void 0){let o=r.token;if(typeof o=="string"&&o!=="")return o}}let n=e.__st;if(n!==void 0){let r=n.cid;if(typeof r=="string"&&r!=="")return r}}catch(e){}return""}function R(){try{let i=document.querySelector("[data-checkout-step]");if(i!==null){let t=i.dataset.checkoutStep;if(t!==void 0&&["cart","information","shipping","payment","review"].includes(t))return t}let e=window.location.pathname.toLowerCase();if(e.includes("/payment"))return"payment";if(e.includes("/shipping"))return"shipping";if(e.includes("/information"))return"information";if(e.includes("/review"))return"review";if(e.includes("/cart"))return"cart"}catch(i){}return"cart"}function G(){var p,u,h,m,f,y,b,P;let i=Ie(),e=Ae(i),t=R(),n=new S(e,t),r=new x({shopDomain:(p=i.shopDomain)!=null?p:"",storefrontAccessToken:(u=i.storefrontAccessToken)!=null?u:"",adminAccessToken:(h=i.adminAccessToken)!=null?h:"",apiVersion:(m=i.apiVersion)!=null?m:"2024-01"}),o=new w,s=new A(r,o),l=new T(n);l.mount(document.body);let c={confidenceThreshold:(f=i.confidenceThreshold)!=null?f:.6,idleTimeoutMs:(y=i.idleTimeoutMs)!=null?y:3e4,exitIntentMarginPx:20,classificationTimeoutMs:2e3},a=new E(n.sessionId),d=new k({analyticsServiceUrl:(b=i.analyticsServiceUrl)!=null?b:"/analytics",platformId:(P=i.shopDomain)!=null?P:""});a.onFrictionEvent(g=>{n.addFrictionEvent(g),s.resolve(g,n).then(F=>{F!==null&&l.show(F)})}),l.onAction(g=>{we(g,n,r,l)}),Te(n,l),window.addEventListener("beforeunload",()=>{try{n.end(),d.flush(n)}catch(g){console.error("[CheckoutRecovery] Error flushing session on beforeunload:",g)}}),ke(n,d),a.start(c)}async function we(i,e,t,n){var r;try{switch(i.actionType){case"apply_coupon":{let o=i.payload,s=o==null?void 0:o.couponCode;if(s===void 0||s==="")break;let l=await t.applyCoupon(e.cartId,s);e.updateInterventionOutcome(i.interventionId,l.success?"accepted":"dismissed",Date.now());break}case"select_shipping":{let o=i.payload,s=o==null?void 0:o.handle;if(s===void 0||s==="")break;let l=await t.selectShipping(e.cartId,s);e.updateInterventionOutcome(i.interventionId,l.success?"accepted":"dismissed",Date.now());break}case"select_variant":{let o=i.payload,s=o==null?void 0:o.variantId,l=(r=o==null?void 0:o.lineItemId)!=null?r:"";if(s===void 0||s==="")break;let c=await t.updateVariant(e.cartId,l,s);e.updateInterventionOutcome(i.interventionId,c.success?"accepted":"dismissed",Date.now());break}case"select_payment":{let o=i.payload,s=o==null?void 0:o.methodId;if(s===void 0||s==="")break;let l=await t.selectPaymentMethod(e.cartId,s);e.updateInterventionOutcome(i.interventionId,l.success?"accepted":"dismissed",Date.now());break}case"dismiss":{n.dismiss("user_dismissed"),e.updateInterventionOutcome(i.interventionId,"dismissed",Date.now());break}case"expand_detail":break;default:{let o=i.actionType;console.warn("[CheckoutRecovery] Unknown action type:",o);break}}}catch(o){console.error("[CheckoutRecovery] Action handler error suppressed:",o)}}function Te(i,e){let t=window.location.pathname;document.addEventListener("page:change",()=>{try{let o=R();o!==i.checkoutStep&&(i.checkoutStep=o,e.dismiss("step_completed"))}catch(o){console.error("[CheckoutRecovery] Error handling page:change:",o)}});let n=new MutationObserver(()=>{try{let o=window.location.pathname;if(o!==t){t=o;let s=R();s!==i.checkoutStep&&(i.checkoutStep=s,e.dismiss("step_completed"))}}catch(o){console.error("[CheckoutRecovery] Error in MutationObserver callback:",o)}}),r=document.querySelector("title");r!==null?n.observe(r,{childList:!0}):n.observe(document.body,{childList:!0,subtree:!1})}function ke(i,e){function t(){try{let n=window.location.pathname.toLowerCase();(n.includes("/thank_you")||n.includes("/orders/")||document.querySelector("[data-order-id]")!==null||document.querySelector(".order-confirmation")!==null)&&(i.markConverted(),e.flush(i))}catch(n){console.error("[CheckoutRecovery] Error checking for order confirmation:",n)}}t(),document.addEventListener("page:change",t)}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{try{G()}catch(i){console.error("[CheckoutRecovery] Initialisation failed \u2014 checkout unaffected:",i)}});else try{G()}catch(i){console.error("[CheckoutRecovery] Initialisation failed \u2014 checkout unaffected:",i)}})();
