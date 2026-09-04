import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './css/instructions.css';
import { setupLinkStreamForm, pollLoop } from './app';
import { setupUrlBuilder } from './urlBuilder';

// Review-only: ?score=tab|inset|rails|folder|left previews score block variants.
document.body.dataset.scoreStyle = new URLSearchParams(window.location.search).get('score') || 'tab';

setupUrlBuilder();
setupLinkStreamForm();
pollLoop();
