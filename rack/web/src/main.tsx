import { render } from 'preact';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import '@fontsource-variable/doto/wght.css';
import './styles.css';
import { App } from './App';

render(<App />, document.getElementById('app')!);
