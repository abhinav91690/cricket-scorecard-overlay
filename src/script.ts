import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './css/instructions.css';
import { setupLinkStreamForm, pollLoop } from './app';
import { setupUrlBuilder } from './urlBuilder';

// Review-only: ?cardstyle=contrast|tile|banner|float previews event card treatments.
document.body.dataset.cardStyle = new URLSearchParams(window.location.search).get('cardstyle') || 'contrast';

setupUrlBuilder();
setupLinkStreamForm();
pollLoop();
